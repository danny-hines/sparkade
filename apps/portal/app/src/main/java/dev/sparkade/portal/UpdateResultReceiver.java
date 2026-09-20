package dev.sparkade.portal;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;

/** Explicit PendingIntent callback; other apps cannot send update commands. */
public final class UpdateResultReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (!BuildConfig.STANDALONE) return;
        PortalUpdater updater = PortalUpdater.get(context);
        if (Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) {
            // Android has verified/replaced this package. HOME should resume even if its old process died.
            context.startActivity(new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
            return;
        }
        if (!"dev.sparkade.kiosk.UPDATE_RESULT".equals(intent.getAction())) return;
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirmation = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirmation != null && updater.maintenanceActive()) {
                try { context.startActivity(confirmation.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return; }
                catch (RuntimeException ignored) { /* Recover through maintenance instead of crashing. */ }
            }
            int session = intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID, -1);
            if (session != -1) context.getPackageManager().getPackageInstaller().abandonSession(session);
            status = PackageInstaller.STATUS_FAILURE_ABORTED;
        }
        // Android 9 maps verifier rejection to STATUS_FAILURE_ABORTED too; it is not a user cancellation.
        updater.installResult(status, intent.getIntExtra("android.content.pm.extra.LEGACY_STATUS", 0));
        if (status == PackageInstaller.STATUS_SUCCESS)
            context.startActivity(new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
    }
}
