package dev.sparkade.portal;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Synchronous, read-only status for the USB installer. No disk/network access in a receiver. */
public final class SetupStatusReceiver extends BroadcastReceiver {
    private static volatile String state = "not_started";
    private static volatile String code = "";

    static synchronized void update(String next, String pairingCode) {
        state = next.matches("checking|pairing|registered|error|revoked|unsupported") ? next : "error";
        code = pairingCode != null && pairingCode.matches("[A-Z0-9]{4}-[A-Z0-9]{4}") ? pairingCode : "";
    }

    @Override public synchronized void onReceive(Context context, Intent intent) {
        if (!BuildConfig.STANDALONE || !"dev.sparkade.kiosk.SETUP_STATUS".equals(intent.getAction())) return;
        // All fields are fixed or constrained ASCII, so shell clients do not need a JSON parser.
        setResult(Activity.RESULT_OK, "SPARKADE_SETUP_V1;state=" + state + ";code=" + code
                + ";version=" + BuildConfig.VERSION_NAME + ";origin=" + CloudPolicy.ORIGIN + ";", null);
    }
}
