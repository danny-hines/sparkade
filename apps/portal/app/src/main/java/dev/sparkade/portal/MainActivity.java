package dev.sparkade.portal;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.ResolveInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.io.ByteArrayInputStream;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;

/** Small Android host; the existing web shell and Canvas2D engine own the experience. */
public final class MainActivity extends Activity {
    private static final String DEFAULT_URL = CloudPolicy.LOCAL_ORIGIN + "/";
    private static final int MEDIA_PERMISSIONS = 1;
    private WebView web;
    private FrameLayout content;
    private LinearLayout failure;
    private TextView status;
    private String serverUrl;
    private boolean touch;
    private PermissionRequest pendingMedia;
    private UsbGamepad usbGamepad;
    private String usbState = "null";
    private final Handler retryHandler = new Handler(Looper.getMainLooper());
    private boolean loadFailed;
    private boolean resumed;
    private boolean connectionDialogOpen;
    private PortalRuntime runtime;
    private String runtimeError;
    private final ThreadPoolExecutor operations = new ThreadPoolExecutor(2, 2, 30,
            TimeUnit.SECONDS, new ArrayBlockingQueue<>(24));
    private final Runnable updateCheck = new Runnable() {
        @Override public void run() {
            if (BuildConfig.STANDALONE) PortalUpdater.get(MainActivity.this).check(false);
            retryHandler.postDelayed(this, 15 * 60_000);
        }
    };
    private final Runnable retryLoad = () -> {
        if (resumed && loadFailed && !connectionDialogOpen) loadServer();
    };

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN);
        serverUrl = BuildConfig.STANDALONE ? DEFAULT_URL
                : getPreferences(MODE_PRIVATE).getString("server", "http://127.0.0.1:8099/");
        if (BuildConfig.DEBUG && "standalone".equals(getIntent().getStringExtra("sparkade_mode"))) {
            serverUrl = DEFAULT_URL;
            getPreferences(MODE_PRIVATE).edit().putString("server", serverUrl).apply();
        }
        touch = getPreferences(MODE_PRIVATE).getBoolean("touch", false);
        try { runtime = PortalRuntime.get(this); }
        catch (Exception error) { runtimeError = "Cannot open device storage. Restart Sparkade; do not clear app data."; }

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(26, 26, 26));
        // Use the full display; Portal's floating system controls remain above the app.
        content = new FrameLayout(this);
        root.addView(content, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
        createWebView();
        loadServer();
        usbGamepad = new UsbGamepad(this, report -> {
            usbState = KiwitataReport.decode(report);
            sendUsbState();
        });
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void createWebView() {
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(26, 26, 26));
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportZoom(false);
        settings.setUserAgentString(settings.getUserAgentString() + " SparkadePortal/0.1");
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "SparkadePortalNative",
                    Collections.singleton(CloudPolicy.LOCAL_ORIGIN), (view, message, origin, mainFrame, reply) -> {
                if (!mainFrame || !CloudPolicy.LOCAL_ORIGIN.equals(origin.toString())
                        || view.getUrl() == null || !sameOrigin(Uri.parse(view.getUrl()), Uri.parse(DEFAULT_URL))) return;
                String text = message.getData();
                if (text == null || text.length() > 18 * 1024 * 1024) return;
                try {
                    JSONObject request = new JSONObject(text);
                    String id = request.getString("id");
                    if (!id.matches("[A-Za-z0-9-]{1,100}")) return;
                    if (BuildConfig.STANDALONE && "maintenance.state".equals(request.optString("operation"))) {
                        JSONObject args = request.optJSONObject("args");
                        PortalUpdater.get(this).screen(args == null ? "unknown" : args.optString("screen", "unknown"));
                        reply.postMessage(new JSONObject().put("id", id).put("value", true).toString());
                        return;
                    }
                    Runnable operation = () -> {
                        JSONObject response = new JSONObject();
                        try {
                            response.put("id", id);
                            if (runtime == null) throw new IllegalStateException(runtimeError);
                            response.put("value", runtime.execute(request.getString("operation"),
                                    request.optJSONObject("args") == null ? new JSONObject() : request.getJSONObject("args")));
                        } catch (Exception error) {
                            try { response.put("error", error.getMessage() == null ? "Portal operation failed" : error.getMessage()); }
                            catch (Exception ignored) {}
                        }
                        retryHandler.post(() -> { if (web == view) reply.postMessage(response.toString()); });
                    };
                    try { operations.execute(operation); }
                    catch (java.util.concurrent.RejectedExecutionException error) {
                        reply.postMessage(new JSONObject().put("id", id).put("error", "Portal is busy. Please retry.").toString());
                    }
                } catch (Exception ignored) { /* Invalid bridge messages receive no privileges. */ }
            });
        } else runtimeError = "Update the Portal WebView before using standalone Sparkade.";
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (!sameOrigin(Uri.parse(serverUrl), Uri.parse(DEFAULT_URL))) return null;
                if (!sameOrigin(request.getUrl(), Uri.parse(DEFAULT_URL))) return localError(403, "Forbidden");
                String path = request.getUrl().getPath();
                if (!"GET".equals(request.getMethod()) || path == null || path.contains("..")) return localError(404, "Not found");
                WebResourceResponse cached = runtime == null ? null : runtime.asset(path);
                if (cached != null) return cached;
                try {
                    String filename = path.equals("/") ? "/index.html" : path;
                    String mime = filename.endsWith(".js") ? "application/javascript"
                            : filename.endsWith(".css") ? "text/css" : filename.endsWith(".json") ? "application/json"
                            : filename.endsWith(".png") ? "image/png" : filename.endsWith(".svg") ? "image/svg+xml"
                            : filename.endsWith(".woff2") ? "font/woff2" : "text/html";
                    WebResourceResponse response = new WebResourceResponse(mime, "UTF-8", getAssets().open("www" + filename));
                    Map<String, String> headers = new HashMap<>();
                    headers.put("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'");
                    headers.put("X-Content-Type-Options", "nosniff");
                    response.setResponseHeaders(headers);
                    return response;
                } catch (java.io.IOException error) { return localError(404, "Not found"); }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (sameOrigin(request.getUrl(), Uri.parse(serverUrl))) return false;
                Toast.makeText(MainActivity.this, "Open external links on your phone or computer.",
                        Toast.LENGTH_SHORT).show();
                return true;
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request,
                    WebResourceError error) {
                if (request.isForMainFrame()) showFailure("Cannot open Sparkade. Check the app installation or configured server.");
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request,
                    WebResourceResponse response) {
                if (request.isForMainFrame()) showFailure("Server returned HTTP " + response.getStatusCode() + ".");
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                cancelMedia();
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (!loadFailed) failure.setVisibility(View.GONE);
                sendUsbState();
            }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                cancelMedia();
                content.removeView(view);
                view.destroy();
                web = null;
                showFailure("The web player stopped. Tap Retry to reopen it.");
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onConsoleMessage(ConsoleMessage message) {
                Log.d("SparkadeWeb", message.messageLevel() + ": " + message.message());
                return true;
            }
            @Override public void onPermissionRequest(PermissionRequest request) {
                requestMedia(request);
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) {
                if (pendingMedia == request) pendingMedia = null;
            }
        });
        content.addView(web, 0, new FrameLayout.LayoutParams(-1, -1));
        if (failure == null) createFailurePanel();
    }

    private void createFailurePanel() {
        failure = new LinearLayout(this);
        failure.setOrientation(LinearLayout.VERTICAL);
        failure.setGravity(Gravity.CENTER);
        failure.setPadding(dp(32), dp(16), dp(32), dp(16));
        failure.setBackgroundColor(Color.rgb(26, 26, 26));
        status = new TextView(this);
        status.setTextColor(Color.rgb(240, 240, 240));
        status.setTextSize(20);
        status.setGravity(Gravity.CENTER);
        failure.addView(status);
        failure.addView(button("Retry", this::loadServer));
        failure.addView(button(BuildConfig.STANDALONE ? "Device settings" : "Connection settings", this::showSettings));
        content.addView(failure, new FrameLayout.LayoutParams(-1, -1));
    }

    private void loadServer() {
        retryHandler.removeCallbacks(retryLoad);
        loadFailed = false;
        cancelMedia();
        if (web == null) createWebView();
        if (sameOrigin(Uri.parse(serverUrl), Uri.parse(DEFAULT_URL)) && runtimeError != null) {
            showFailure(runtimeError);
            return;
        }
        failure.setVisibility(View.GONE);
        Uri source = Uri.parse(serverUrl);
        Uri.Builder target = source.buildUpon().clearQuery();
        for (String key : source.getQueryParameterNames()) {
            if (key.equals("kiosk") || key.equals("touch")) continue;
            for (String value : source.getQueryParameters(key)) target.appendQueryParameter(key, value);
        }
        target.appendQueryParameter("kiosk", "adaptive").appendQueryParameter("touch", touch ? "1" : "0");
        web.loadUrl(target.build().toString());
        web.requestFocus();
    }

    private void showFailure(String message) {
        loadFailed = true;
        status.setText(message + " Retrying in 5 seconds…");
        failure.setVisibility(View.VISIBLE);
        scheduleRetry();
    }

    private void scheduleRetry() {
        retryHandler.removeCallbacks(retryLoad);
        if (resumed && loadFailed && !connectionDialogOpen) retryHandler.postDelayed(retryLoad, 5000);
    }

    /** Back opens an operator panel; it does not silently navigate out of a game. */
    @Override public void onBackPressed() { showSettings(); }

    private void showSettings() {
        if (connectionDialogOpen) return;
        connectionDialogOpen = true;
        sendUsbState();
        retryHandler.removeCallbacks(retryLoad);
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp(24), dp(16), dp(24), dp(16));
        panel.setBackgroundColor(Color.rgb(43, 43, 43));
        EditText address = new EditText(this);
        address.setText(serverUrl);
        address.setTextSize(18);
        address.setTextColor(Color.rgb(240, 240, 240));
        address.setMinHeight(dp(52));
        address.setSingleLine(true);
        address.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        address.setEnabled(!BuildConfig.STANDALONE);
        if (!BuildConfig.STANDALONE) panel.addView(address);
        if (!BuildConfig.STANDALONE) panel.addView(button("Use standalone Sparkade", () -> {
            address.setText(DEFAULT_URL);
        }));
        CheckBox controls = new CheckBox(this);
        controls.setText(R.string.touch_controls);
        controls.setTextColor(Color.rgb(240, 240, 240));
        controls.setTextSize(18);
        controls.setChecked(touch);
        controls.setMinHeight(dp(52));
        panel.addView(controls);
        PackageInfo engine = WebView.getCurrentWebViewPackage();
        TextView info = new TextView(this);
        info.setTextSize(16);
        info.setTextColor(Color.rgb(218, 218, 218));
        info.setText(getString(BuildConfig.STANDALONE ? R.string.standalone_info : R.string.connection_info, Build.MODEL, Build.VERSION.RELEASE,
                engine == null ? "unavailable" : engine.versionName));
        panel.addView(info);
        TextView controllerInfo = new TextView(this);
        controllerInfo.setTextColor(Color.rgb(218, 218, 218));
        controllerInfo.setText(usbGamepad == null ? "USB controller unavailable" : usbGamepad.status());
        panel.addView(controllerInfo);
        panel.addView(button("Retry USB controller", () -> { if (usbGamepad != null) usbGamepad.retry(); }));
        AlertDialog dialog = new AlertDialog.Builder(this, R.style.SparkadeDialog).setTitle(BuildConfig.STANDALONE ? "Sparkade device settings" : "Sparkade connection")
                .setView(panel).setNegativeButton("Cancel", null)
                .setNeutralButton("Other launchers", (d, which) -> showOtherLaunchers())
                .setPositiveButton(BuildConfig.STANDALONE ? "Save" : "Connect", null).create();
        if (BuildConfig.STANDALONE) panel.addView(button("Sparkade updates", () -> {
            if (!PortalUpdater.get(this).enterMaintenance()) {
                Toast.makeText(this, "Return to Press Start, the library, or Settings before updating. Finish any game or generation first.", Toast.LENGTH_LONG).show();
                return;
            }
            dialog.dismiss();
            startActivity(new Intent(this, UpdateActivity.class));
        }));
        dialog.setOnDismissListener(ignored -> {
            connectionDialogOpen = false;
            sendUsbState();
            scheduleRetry();
        });
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            String value = address.getText().toString().trim();
            if (!validServer(value)) {
                address.setError("Use HTTPS, or http://127.0.0.1:8099/ over USB.");
                return;
            }
            serverUrl = value;
            touch = controls.isChecked();
            getPreferences(MODE_PRIVATE).edit().putString("server", serverUrl).putBoolean("touch", touch).apply();
            dialog.dismiss();
            loadServer();
        }));
        dialog.show();
        if (dialog.getWindow() != null) {
            dialog.getWindow().setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(Color.rgb(43, 43, 43)));
        }
    }

    /** Launch an existing Home app explicitly, even when Sparkade is the default. */
    private void showOtherLaunchers() {
        Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
        List<ResolveInfo> launchers = new ArrayList<>();
        List<String> labels = new ArrayList<>();
        for (ResolveInfo candidate : getPackageManager().queryIntentActivities(home, 0)) {
            if (getPackageName().equals(candidate.activityInfo.packageName)) continue;
            launchers.add(candidate);
            labels.add(candidate.activityInfo.packageName.equals("dev.sparkade.portal")
                    ? "Sparkade bench prototype" : candidate.loadLabel(getPackageManager()).toString());
        }
        labels.add("Android settings");
        AlertDialog chooser = new AlertDialog.Builder(this, R.style.SparkadeDialog)
                .setTitle("Open another app")
                .setItems(labels.toArray(new String[0]), (dialog, index) -> {
                    try {
                        if (index == launchers.size()) startActivity(new Intent(android.provider.Settings.ACTION_SETTINGS));
                        else {
                            ResolveInfo target = launchers.get(index);
                            startActivity(new Intent(home).setComponent(new ComponentName(
                                    target.activityInfo.packageName, target.activityInfo.name))
                                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                        }
                    } catch (android.content.ActivityNotFoundException error) {
                        Toast.makeText(this, "That app is unavailable.", Toast.LENGTH_SHORT).show();
                    }
                }).setNegativeButton("Cancel", null).create();
        chooser.show();
        if (chooser.getWindow() != null) chooser.getWindow().setBackgroundDrawable(
                new android.graphics.drawable.ColorDrawable(Color.rgb(43, 43, 43)));
    }

    private void sendUsbState() {
        if (web == null || web.getUrl() == null
                || !sameOrigin(Uri.parse(web.getUrl()), Uri.parse(serverUrl))) return;
        String state = resumed && !connectionDialogOpen && !loadFailed ? usbState : "null";
        web.evaluateJavascript("window.dispatchEvent(new CustomEvent('sparkade:usb-gamepad',{detail:"
                + state + "}))", null);
    }

    private boolean validServer(String value) {
        Uri uri = Uri.parse(value);
        String host = uri.getHost();
        if (host == null || host.isEmpty() || uri.getUserInfo() != null) return false;
        return "https".equals(uri.getScheme()) || ("http".equals(uri.getScheme())
                && ("localhost".equals(host) || "127.0.0.1".equals(host)));
    }

    private static int effectivePort(Uri uri) {
        return uri.getPort() == -1 ? ("https".equals(uri.getScheme()) ? 443 : 80) : uri.getPort();
    }

    private static boolean sameOrigin(Uri first, Uri second) {
        return first.getScheme() != null && first.getScheme().equals(second.getScheme())
                && first.getHost() != null && first.getHost().equals(second.getHost())
                && effectivePort(first) == effectivePort(second);
    }

    private void requestMedia(PermissionRequest request) {
        if (pendingMedia != null || !sameOrigin(request.getOrigin(), Uri.parse(serverUrl))) {
            request.deny();
            return;
        }
        List<String> missing = new ArrayList<>();
        for (String resource : request.getResources()) {
            String permission = androidPermission(resource);
            if (permission != null && checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) {
                missing.add(permission);
            }
        }
        pendingMedia = request;
        if (missing.isEmpty()) grantMedia();
        else requestPermissions(missing.toArray(new String[0]), MEDIA_PERMISSIONS);
    }

    private static String androidPermission(String resource) {
        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) return Manifest.permission.CAMERA;
        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) return Manifest.permission.RECORD_AUDIO;
        return null;
    }

    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code == MEDIA_PERMISSIONS) grantMedia();
    }

    private void grantMedia() {
        if (pendingMedia == null) return;
        PermissionRequest request = pendingMedia;
        pendingMedia = null;
        if (!sameOrigin(request.getOrigin(), Uri.parse(serverUrl)) || web == null
                || web.getUrl() == null || !sameOrigin(Uri.parse(web.getUrl()), request.getOrigin())) {
            request.deny();
            return;
        }
        List<String> allowed = new ArrayList<>();
        for (String resource : request.getResources()) {
            String permission = androidPermission(resource);
            if (permission != null && checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED) {
                allowed.add(resource);
            }
        }
        if (allowed.isEmpty()) request.deny();
        else request.grant(allowed.toArray(new String[0]));
    }

    private void cancelMedia() {
        if (pendingMedia != null) {
            pendingMedia.deny();
            pendingMedia = null;
        }
    }

    @Override protected void onPause() {
        resumed = false;
        if (usbGamepad != null) usbGamepad.pause();
        retryHandler.removeCallbacks(retryLoad);
        if (web != null) {
            web.evaluateJavascript("window.dispatchEvent(new Event('blur'))", null);
            web.onPause();
            web.pauseTimers();
        }
        retryHandler.removeCallbacks(updateCheck);
        super.onPause();
    }

    @Override protected void onResume() {
        super.onResume();
        retryHandler.removeCallbacks(updateCheck);
        retryHandler.postDelayed(updateCheck, 30_000);
        resumed = true;
        if (web != null) { web.onResume(); web.resumeTimers(); }
        if (usbGamepad != null) usbGamepad.resume();
        scheduleRetry();
    }

    @Override protected void onDestroy() {
        operations.shutdownNow();
        retryHandler.removeCallbacksAndMessages(null);
        cancelMedia();
        if (usbGamepad != null) usbGamepad.destroy();
        if (web != null) { content.removeView(web); web.destroy(); web = null; }
        super.onDestroy();
    }

    private Button button(String title, Runnable action) {
        Button button = new Button(this);
        button.setText(title);
        button.setTextSize(18);
        button.setTextColor(Color.rgb(240, 240, 240));
        button.setMinHeight(dp(52));
        button.setOnClickListener(view -> action.run());
        return button;
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private static WebResourceResponse localError(int status, String reason) {
        return new WebResourceResponse("text/plain", "UTF-8", status, reason,
                Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }
}
