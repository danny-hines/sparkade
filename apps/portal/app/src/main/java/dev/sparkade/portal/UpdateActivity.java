package dev.sparkade.portal;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.provider.Settings;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.*;

/** Operator maintenance screen; no install controls are exposed to web game content. */
public final class UpdateActivity extends Activity {
    private final Handler handler = new Handler(android.os.Looper.getMainLooper());
    private PortalUpdater updater;
    private TextView status;
    private Button check, install;
    private CheckBox pilot;
    private final Runnable refresh = new Runnable() {
        @Override public void run() {
            status.setText(updater.message());
            check.setEnabled(!updater.busy());
            pilot.setEnabled(!updater.busy());
            install.setEnabled(updater.ready() && updater.maintenanceActive());
            handler.postDelayed(this, 500);
        }
    };
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        updater = PortalUpdater.get(this);
        if (!BuildConfig.STANDALONE || !updater.maintenanceActive()) { finish(); return; }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_FULLSCREEN);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL); layout.setGravity(Gravity.CENTER_HORIZONTAL);
        layout.setPadding(dp(48), dp(70), dp(48), dp(32)); layout.setBackgroundColor(Color.rgb(8, 13, 27));
        layout.addView(label("Sparkade updates", 32));
        layout.addView(label("Installed: " + BuildConfig.VERSION_NAME + " · " + android.os.Build.MODEL, 20));
        status = label(updater.message(), 23); layout.addView(status);
        layout.addView(label("Updates download over Wi-Fi. Android asks you to confirm installation.\nYour kiosk registration, games, and controller settings are kept.", 18));
        pilot = new CheckBox(this); pilot.setText("Use pilot releases on this test kiosk");
        pilot.setTextSize(20); pilot.setChecked("pilot".equals(updater.channel()));
        pilot.setOnCheckedChangeListener((button, value) -> updater.setChannel(value ? "pilot" : "stable"));
        layout.addView(pilot);
        check = button("Check for updates", () -> updater.check(true)); layout.addView(check);
        install = button("Install update", () -> {
            if (!getPackageManager().canRequestPackageInstalls()) {
                try { startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()))); }
                catch (RuntimeException error) { status.setText("Use the Mac setup installer to enable app updates on this Portal."); }
            } else updater.install();
        }); layout.addView(install);
        layout.addView(button("Return to Sparkade", this::finish));
        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true); scroll.addView(layout); setContentView(scroll);
        updater.check(false);
    }
    @Override protected void onResume() { super.onResume(); if (status != null) handler.post(refresh); }
    @Override protected void onPause() { handler.removeCallbacks(refresh); super.onPause(); }
    @Override protected void onDestroy() { if (isFinishing()) updater.leaveMaintenance(); super.onDestroy(); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private TextView label(String text, int size) {
        TextView view = new TextView(this); view.setText(text); view.setTextSize(size);
        view.setTextColor(Color.WHITE); view.setGravity(Gravity.CENTER); view.setPadding(0, dp(14), 0, dp(14)); return view;
    }
    private Button button(String text, Runnable action) {
        Button button = new Button(this); button.setText(text); button.setTextSize(20);
        button.setMinHeight(dp(58)); button.setOnClickListener(v -> action.run()); return button;
    }
}
