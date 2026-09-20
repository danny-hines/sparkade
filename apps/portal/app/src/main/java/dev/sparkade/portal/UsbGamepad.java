package dev.sparkade.portal;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.hardware.usb.UsbRequest;
import android.os.Build;
import android.util.Log;
import android.view.InputDevice;
import java.nio.ByteBuffer;
import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeoutException;

/** Scoped fallback for the tested Kiwitata, when the OS provides no HID driver. */
final class UsbGamepad {
    interface Listener { void onReport(byte[] report); }
    private static final String TAG = "SparkadeUsb";
    private static final String PERMISSION = "dev.sparkade.portal.USB_PERMISSION";
    private final Activity activity;
    private final UsbManager manager;
    private final Listener listener;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private Session session;
    private String pendingPermission;
    private String deniedDevice;
    private boolean resumed;
    private boolean destroyed;
    private String status = "No supported USB controller detected";

    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            UsbDevice device = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
            if (device == null || !supported(device)) return;
            if (PERMISSION.equals(intent.getAction())) {
                if (!device.getDeviceName().equals(pendingPermission)) return;
                pendingPermission = null;
                if (!manager.hasPermission(device)) {
                    deniedDevice = device.getDeviceName();
                    status = "USB controller permission denied";
                }
            } else if (UsbManager.ACTION_USB_DEVICE_DETACHED.equals(intent.getAction())) {
                if (session != null && session.device.getDeviceName().equals(device.getDeviceName())) stop();
                deniedDevice = null;
                pendingPermission = null;
                status = "USB controller disconnected";
            }
            scan();
        }
    };

    UsbGamepad(Activity activity, Listener listener) {
        this.activity = activity;
        this.listener = listener;
        manager = (UsbManager) activity.getSystemService(Context.USB_SERVICE);
        IntentFilter filter = new IntentFilter(PERMISSION);
        filter.addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED);
        filter.addAction(UsbManager.ACTION_USB_DEVICE_DETACHED);
        if (Build.VERSION.SDK_INT >= 33) activity.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
        else activity.registerReceiver(receiver, filter);
    }

    private static boolean supported(UsbDevice device) {
        return device.getVendorId() == 0x0079 && device.getProductId() == 0x0011;
    }

    private static boolean handledByAndroid(UsbDevice device) {
        for (int id : InputDevice.getDeviceIds()) {
            InputDevice input = InputDevice.getDevice(id);
            if (input != null && input.getVendorId() == device.getVendorId()
                    && input.getProductId() == device.getProductId()) return true;
        }
        return false;
    }

    void resume() { resumed = true; scan(); }
    void pause() { resumed = false; stop(); }
    String status() { return status; }
    void retry() { deniedDevice = null; stop(); scan(); }
    void destroy() {
        destroyed = true;
        pause();
        activity.unregisterReceiver(receiver);
        worker.shutdown();
    }

    private void scan() {
        if (!resumed || destroyed || session != null || pendingPermission != null) return;
        for (UsbDevice device : manager.getDeviceList().values()) {
            if (!supported(device)) continue;
            if (handledByAndroid(device)) {
                status = "USB controller handled by Android";
                continue;
            }
            if (device.getDeviceName().equals(deniedDevice)) continue;
            if (!manager.hasPermission(device)) {
                pendingPermission = device.getDeviceName();
                status = "Waiting for USB controller permission";
                int flags = PendingIntent.FLAG_UPDATE_CURRENT;
                if (Build.VERSION.SDK_INT >= 31) flags |= PendingIntent.FLAG_MUTABLE;
                PendingIntent permission = PendingIntent.getBroadcast(activity, 0,
                        new Intent(PERMISSION).setPackage(activity.getPackageName()), flags);
                manager.requestPermission(device, permission);
                return;
            }
            session = new Session(device);
            worker.execute(session);
            return;
        }
    }

    private void stop() {
        if (session != null) {
            session.alive = false;
            session = null;
        }
        listener.onReport(null);
    }

    private final class Session implements Runnable {
        final UsbDevice device;
        volatile boolean alive = true;
        Session(UsbDevice device) { this.device = device; }

        private void publish(byte[] report) {
            activity.runOnUiThread(() -> {
                if (session == this && resumed && !destroyed) listener.onReport(report);
            });
        }

        @Override public void run() {
            UsbDeviceConnection connection = null;
            UsbRequest request = null;
            UsbInterface hid = null;
            try {
                UsbEndpoint endpoint = null;
                for (int i = 0; i < device.getInterfaceCount() && endpoint == null; i++) {
                    UsbInterface candidate = device.getInterface(i);
                    if (candidate.getInterfaceClass() != UsbConstants.USB_CLASS_HID) continue;
                    for (int j = 0; j < candidate.getEndpointCount(); j++) {
                        UsbEndpoint e = candidate.getEndpoint(j);
                        if (e.getDirection() == UsbConstants.USB_DIR_IN
                                && e.getType() == UsbConstants.USB_ENDPOINT_XFER_INT) {
                            hid = candidate;
                            endpoint = e;
                            break;
                        }
                    }
                }
                if (!alive) return;
                if (endpoint == null) throw new IllegalStateException("No HID input endpoint");
                connection = manager.openDevice(device);
                if (connection == null || !connection.claimInterface(hid, false))
                    throw new IllegalStateException("Cannot open USB controller interface");
                byte[] descriptor = new byte[1024];
                int size = connection.controlTransfer(0x81, 0x06, 0x2200, hid.getId(), descriptor, descriptor.length, 1000);
                if (!KiwitataReport.supports(descriptor, size))
                    throw new IllegalStateException("Unsupported controller report format");
                if (BuildConfig.DEBUG) Log.d(TAG, "Kiwitata descriptor verified; reading USB input");
                request = new UsbRequest();
                if (!request.initialize(connection, endpoint)) throw new IllegalStateException("Cannot initialize HID reader");
                ByteBuffer buffer = ByteBuffer.allocateDirect(endpoint.getMaxPacketSize());
                boolean queued = false;
                byte[] previous = null;
                int logged = 0;
                activity.runOnUiThread(() -> { if (session == this) status = "Kiwitata USB controller connected"; });
                while (alive) {
                    if (!queued) {
                        buffer.clear();
                        if (!request.queue(buffer)) throw new IllegalStateException("Cannot queue USB input");
                        queued = true;
                    }
                    try {
                        if (connection.requestWait(500) != request) throw new IllegalStateException("USB controller read failed");
                    } catch (TimeoutException timeout) { continue; }
                    queued = false;
                    byte[] report = new byte[buffer.position()];
                    buffer.flip();
                    buffer.get(report);
                    if (!Arrays.equals(previous, report)) {
                        if (BuildConfig.DEBUG && logged++ < 32) Log.d(TAG, "HID report: " + hex(report, report.length));
                        previous = report;
                        publish(report);
                    }
                }
            } catch (RuntimeException error) {
                if (alive) {
                    Log.w(TAG, "USB controller unavailable", error);
                    activity.runOnUiThread(() -> {
                        if (session == this) status = "USB controller: " + error.getMessage();
                    });
                }
            } finally {
                if (request != null) { request.cancel(); request.close(); }
                if (connection != null) {
                    if (hid != null) connection.releaseInterface(hid);
                    connection.close();
                }
                publish(null);
            }
        }
    }

    private static String hex(byte[] bytes, int length) {
        StringBuilder value = new StringBuilder();
        for (int i = 0; i < length; i++) value.append(String.format("%02x", bytes[i] & 0xff));
        return value.toString();
    }
}
