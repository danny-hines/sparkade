package dev.sparkade.portal;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.net.wifi.WifiConfiguration;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import java.io.ByteArrayOutputStream;
import java.io.FileNotFoundException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/** DUMP-protected, authorized ADB only. No WebView access and no credential storage/logging. */
@SuppressWarnings("deprecation")
public final class WifiSetupProvider extends ContentProvider {
    private final AtomicBoolean busy = new AtomicBoolean();
    private final ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor();
    private volatile String state = "idle";
    private volatile String requestId = "";

    @Override public boolean onCreate() { return true; }
    @Override public Bundle call(String method, String arg, Bundle extras) {
        // ContentProvider.call does not automatically enforce manifest read/write permissions.
        getContext().enforceCallingPermission(android.Manifest.permission.DUMP, "Authorized setup only");
        Bundle result = new Bundle();
        if (!BuildConfig.STANDALONE || Build.VERSION.SDK_INT != 28) result.putString("state", "unsupported");
        else if ("status".equals(method)) { result.putString("state", state); result.putString("requestId", requestId); }
        else throw new IllegalArgumentException("Unsupported setup operation");
        return result;
    }

    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        getContext().enforceCallingPermission(android.Manifest.permission.DUMP, "Authorized setup only");
        if (!BuildConfig.STANDALONE || Build.VERSION.SDK_INT != 28 || !"/configure".equals(uri.getPath())
                || !"w".equals(mode) || !busy.compareAndSet(false, true)) throw new FileNotFoundException("Setup unavailable");
        try {
            ParcelFileDescriptor[] pipe = ParcelFileDescriptor.createPipe();
            requestId = ""; state = "reading";
            new Thread(() -> {
                // An interrupted ADB client cannot hold the setup worker indefinitely.
                var timeout = timer.schedule(() -> { try { pipe[0].close(); } catch (Exception ignored) {} }, 10, TimeUnit.SECONDS);
                try (InputStream input = new ParcelFileDescriptor.AutoCloseInputStream(pipe[0])) {
                    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                    int value;
                    while ((value = input.read()) != -1) {
                        if (bytes.size() >= 512) throw new IllegalArgumentException();
                        bytes.write(value);
                    }
                    timeout.cancel(false);
                    WifiSetupPolicy request = new WifiSetupPolicy(new String(bytes.toByteArray(), StandardCharsets.US_ASCII));
                    requestId = request.requestId;
                    connect(request);
                } catch (Exception ignored) {
                    // Never log an exception/payload: Wi-Fi requests contain a password.
                    state = "failed";
                } finally { timeout.cancel(false); busy.set(false); }
            }, "SparkadeWifiSetup").start();
            return pipe[1];
        } catch (Exception ignored) { busy.set(false); state = "failed"; throw new FileNotFoundException("Setup unavailable"); }
    }

    private void connect(WifiSetupPolicy request) throws Exception {
        WifiManager wifi = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wifi == null || !wifi.isWifiEnabled()) { state = "wifi_disabled"; return; }
        WifiInfo previous = wifi.getConnectionInfo();
        int previousId = previous == null ? -1 : previous.getNetworkId();
        WifiConfiguration config = new WifiConfiguration();
        config.SSID = request.ssidHex; // Android accepts raw UTF-8 hex, without shell/string escaping.
        config.hiddenSSID = request.hidden;
        if (request.security.equals("open")) config.allowedKeyManagement.set(WifiConfiguration.KeyMgmt.NONE);
        else {
            config.allowedKeyManagement.set(WifiConfiguration.KeyMgmt.WPA_PSK);
            config.allowedProtocols.set(WifiConfiguration.Protocol.RSN);
            config.preSharedKey = request.androidKey();
        }
        int id = wifi.addNetwork(config);
        if (id < 0) { state = "rejected"; return; }
        state = "connecting";
        if (wifi.enableNetwork(id, true) && wifi.reconnect()) {
            long deadline = SystemClock.elapsedRealtime() + 45000;
            while (SystemClock.elapsedRealtime() < deadline) {
                WifiInfo info = wifi.getConnectionInfo();
                if (info != null && info.getNetworkId() == id && info.getIpAddress() != 0
                        && info.getSupplicantState() == android.net.wifi.SupplicantState.COMPLETED) {
                    state = "connected"; return; // Registration separately proves internet access.
                }
                Thread.sleep(1000);
            }
        }
        if (previousId >= 0 && previousId != id) { wifi.enableNetwork(previousId, true); wifi.reconnect(); }
        state = "connection_failed";
    }

    @Override public String getType(Uri uri) { return "application/octet-stream"; }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String order) { throw new UnsupportedOperationException(); }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException(); }
}
