package dev.sparkade.portal;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;
import androidx.webkit.WebViewFeature;

/** Controller-free, operator-only enrollment. Normal Home startup still opens the arcade. */
public final class SetupActivity extends Activity {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private TextView message;
    private TextView pairingCode;
    private Button retry;
    private Button finish;
    private boolean active;
    private boolean busy;
    private boolean registered;
    private boolean compatible;
    private final Runnable poll = () -> checkRegistration();

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        if (!BuildConfig.STANDALONE) { finish(); return; }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_FULLSCREEN);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER_HORIZONTAL);
        layout.setPadding(dp(48), dp(80), dp(48), dp(32));
        layout.setBackgroundColor(Color.rgb(8, 13, 27));
        layout.addView(label("Set up this Sparkade", 30));
        layout.addView(label(android.os.Build.MODEL + " · Sparkade " + BuildConfig.VERSION_NAME + " · Production", 18));
        message = label("Connecting to sparkade.dev…", 22);
        layout.addView(message);
        pairingCode = label("", 48);
        pairingCode.setTextIsSelectable(true);
        layout.addView(pairingCode);
        layout.addView(label("On your computer, open:\nsparkade.dev/admin/kiosks\nSign in, enter this code, name the kiosk, and choose game visibility.", 20));
        retry = button("Retry connection", this::checkRegistration);
        layout.addView(retry);
        layout.addView(button("Wi-Fi settings", () -> {
            try { startActivity(new Intent(Settings.ACTION_WIFI_SETTINGS)); }
            catch (RuntimeException error) { message.setText("Open Wi-Fi from Portal settings, then return here."); }
        }));
        finish = button("Open Sparkade", () -> {
            startActivity(new Intent(this, MainActivity.class));
            finish();
        });
        finish.setEnabled(false);
        layout.addView(finish);
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.addView(layout);
        setContentView(scroll);
        compatible = WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER);
        SetupStatusReceiver.update(compatible ? "checking" : "unsupported", null);
        if (!compatible) {
            message.setText("This Portal's WebView is too old for standalone Sparkade. Update Portal software, then rerun setup.");
            retry.setEnabled(false);
        }
    }

    private void checkRegistration() {
        if (!active || busy || registered || !compatible) return;
        handler.removeCallbacks(poll);
        busy = true;
        retry.setEnabled(false);
        worker.execute(() -> {
            JSONObject result;
            try {
                PortalRuntime runtime = PortalRuntime.get(this);
                result = (JSONObject) runtime.execute("registration.status", new JSONObject());
                String state = result.optString("state");
                if (state.equals("unregistered") || state.equals("expired"))
                    result = (JSONObject) runtime.execute("registration.pair", new JSONObject());
            } catch (Exception error) {
                result = new JSONObject();
                try { result.put("state", "error").put("message", "Cannot access kiosk storage or registration. Restart Sparkade and retry; do not clear app data."); }
                catch (Exception ignored) {}
            }
            JSONObject status = result;
            handler.post(() -> {
                busy = false;
                if (isFinishing() || isDestroyed()) return;
                String state = status.optString("state", "error");
                registered = state.equals("registered");
                SetupStatusReceiver.update(state, status.optString("pairingCode", null));
                pairingCode.setText(state.equals("pairing") ? status.optString("pairingCode") : "");
                if (registered) message.setText("Registered as " + status.optString("name")
                        + "\nYou can disconnect USB and attach the controller.\nNew games: "
                        + (status.optString("defaultFeedVisibility").equals("listed") ? "listed in public feed" : "unlisted"));
                else if (state.equals("pairing")) message.setText("Enter this code in kiosk administration.\nExpires: "
                        + status.optString("expiresAt") + "\nThis screen will confirm registration automatically.");
                else if (state.equals("revoked")) message.setText("This kiosk's registration was revoked. Contact your Sparkade administrator before re-enrolling it.");
                else message.setText("Could not reach Sparkade production. Check the Portal's Wi-Fi, then retry.\n"
                        + status.optString("message", ""));
                finish.setEnabled(registered);
                retry.setEnabled(!registered);
                // Refresh short-lived codes and recover automatically when Wi-Fi returns.
                if (active && !registered && !state.equals("revoked")) handler.postDelayed(poll, state.equals("pairing") ? 3000 : 10000);
            });
        });
    }

    @Override protected void onResume() {
        super.onResume();
        if (!BuildConfig.STANDALONE || isFinishing()) return;
        active = true; checkRegistration();
    }
    @Override protected void onPause() { active = false; handler.removeCallbacks(poll); super.onPause(); }
    @Override protected void onDestroy() { handler.removeCallbacks(poll); worker.shutdown(); super.onDestroy(); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private TextView label(String text, int size) {
        TextView view = new TextView(this);
        view.setText(text); view.setTextSize(size); view.setTextColor(Color.WHITE);
        view.setGravity(Gravity.CENTER); view.setPadding(0, dp(12), 0, dp(12));
        return view;
    }
    private Button button(String text, Runnable action) {
        Button button = new Button(this);
        button.setText(text); button.setMinHeight(dp(52)); button.setOnClickListener(v -> action.run());
        return button;
    }
}
