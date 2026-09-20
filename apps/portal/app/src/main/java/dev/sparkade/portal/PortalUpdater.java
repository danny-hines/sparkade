package dev.sparkade.portal;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.SystemClock;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/** App-private staged APKs, pinned release URLs, platform signature checks, explicit installation. */
final class PortalUpdater {
    @android.annotation.SuppressLint("StaticFieldLeak") // Application context only.
    private static PortalUpdater instance;
    static synchronized PortalUpdater get(Context context) {
        if (instance == null) instance = new PortalUpdater(context.getApplicationContext());
        return instance;
    }
    private final Context context;
    private final SharedPreferences prefs;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final File apk;
    private volatile boolean busy;
    private volatile String message = "Check for a Sparkade update.";
    private String screen = "unknown";
    private long screenAt;
    private long maintenanceUntil;
    private JSONObject release;

    private PortalUpdater(Context context) {
        this.context = context;
        prefs = context.getSharedPreferences("updates", Context.MODE_PRIVATE);
        apk = new File(context.getCacheDir(), "sparkade-update.apk");
        long target = prefs.getLong("installTarget", 0);
        if (target > 0 && BuildConfig.VERSION_CODE >= target) {
            prefs.edit().putString("state", "updated").putLong("installTarget", 0).apply();
            message = "Updated to Sparkade " + BuildConfig.VERSION_NAME + ".";
            apk.delete();
        } else if (target > 0) {
            // Recover cancellation or process death without repeatedly opening Android's installer.
            prefs.edit().putString("state", "failed").putLong("installTarget", 0).apply();
            message = "The last update did not finish. Check again to retry.";
        }
    }
    synchronized void screen(String value) { screen = value; screenAt = SystemClock.elapsedRealtime(); }
    synchronized boolean enterMaintenance() {
        if (!UpdatePolicy.maintenance(screen, SystemClock.elapsedRealtime() - screenAt)) return false;
        maintenanceUntil = SystemClock.elapsedRealtime() + 60 * 60_000;
        return true;
    }
    synchronized void leaveMaintenance() { maintenanceUntil = 0; }
    synchronized boolean maintenanceActive() { return maintenanceUntil > SystemClock.elapsedRealtime(); }
    String channel() { return prefs.getString("channel", "stable"); }
    String state() { return prefs.getString("state", "idle"); }
    String message() { return message; }
    boolean busy() { return busy; }
    synchronized boolean ready() { return !busy && release != null && apk.isFile() && "ready".equals(state()); }
    void setChannel(String value) {
        if (!UpdatePolicy.channel(value) || busy) return;
        synchronized (this) { release = null; }
        apk.delete();
        prefs.edit().putString("channel", value).putLong("checkedAt", 0).putString("state", "idle").apply();
        check(true);
    }
    private void status(String state, String text) {
        message = text;
        prefs.edit().putString("state", state).apply();
    }
    synchronized void check(boolean manual) {
        if (!BuildConfig.STANDALONE || busy) return;
        // Each kiosk checks at most four times/day automatically; manual retry remains available.
        if (!manual && System.currentTimeMillis() - prefs.getLong("checkedAt", 0) < 6 * 60 * 60_000L) return;
        busy = true;
        worker.execute(() -> {
            try {
                status("checking", "Checking the " + channel() + " channel…");
                prefs.edit().putLong("checkedAt", System.currentTimeMillis()).apply();
                byte[] bytes = download(UpdatePolicy.manifestUrl(channel()), null, 32 * 1024, true);
                if (bytes == null) {
                    synchronized (this) { release = null; }
                    apk.delete();
                    status("current", "No release has been published to the " + channel() + " channel yet.");
                    return;
                }
                JSONObject candidate = new JSONObject(new String(bytes, java.nio.charset.StandardCharsets.UTF_8));
                if (candidate.optBoolean("disabled") && channel().equals(candidate.optString("channel"))) {
                    synchronized (this) { release = null; }
                    apk.delete(); status("current", "Updates are paused on " + channel() + ". Your current version is kept."); return;
                }
                String version = candidate.getString("version"), hash = candidate.getString("apkSha256");
                long code = candidate.getLong("versionCode"), size = candidate.getLong("apkBytes");
                if (!"dev.sparkade.kiosk".equals(candidate.getString("applicationId"))
                        || !UpdatePolicy.version(version) || !UpdatePolicy.hash(hash)
                        || !candidate.getString("tag").equals("portal-v" + version)
                        || !channel().equals(candidate.getString("channel"))
                        || code <= 0 || code > Integer.MAX_VALUE || size <= 0 || size > UpdatePolicy.MAX_APK_BYTES)
                    throw new IOException("Invalid update information. Please contact your Sparkade administrator.");
                if (code <= BuildConfig.VERSION_CODE) {
                    synchronized (this) { release = null; }
                    apk.delete();
                    status("current", "Sparkade " + BuildConfig.VERSION_NAME + " is up to date on " + channel() + ".");
                    return;
                }
                if (!apk.isFile() || apk.length() != size || !hash.equals(digest(apk))) {
                    if (context.getCacheDir().getUsableSpace() < size * 2 + 50 * 1024 * 1024)
                        throw new IOException("Not enough storage for this update. Installed games have been kept.");
                    status("downloading", "Downloading Sparkade " + version + "… You can return to your game.");
                    File part = new File(context.getCacheDir(), "sparkade-update.part");
                    try {
                        download(UpdatePolicy.apkUrl(version), part, size, false);
                        verify(part, candidate);
                        if (!part.renameTo(apk)) throw new IOException("Could not stage the update. Please retry.");
                    } finally { part.delete(); }
                }
                verify(apk, candidate);
                synchronized (this) { release = candidate; }
                status("ready", "Sparkade " + version + " is ready. Installing restarts Sparkade; registration and games are kept.");
            } catch (Exception error) {
                synchronized (this) { release = null; }
                status("failed", error instanceof IOException ? error.getMessage() : "Could not verify the update. Please retry.");
            } finally { busy = false; }
        });
    }
    void install() {
        final JSONObject candidate;
        synchronized (this) {
            if (!ready() || !maintenanceActive()) return;
            candidate = release;
            busy = true;
        }
        worker.execute(() -> {
            PackageInstaller installer = context.getPackageManager().getPackageInstaller();
            int id = -1;
            try {
                byte[] latestBytes = download(UpdatePolicy.manifestUrl(channel()), null, 32 * 1024, true);
                JSONObject latest = latestBytes == null ? new JSONObject() : new JSONObject(new String(latestBytes, java.nio.charset.StandardCharsets.UTF_8));
                if (latest.optBoolean("disabled") || !channel().equals(latest.optString("channel"))
                        || !candidate.getString("apkSha256").equals(latest.optString("apkSha256"))
                        || candidate.getLong("versionCode") != latest.optLong("versionCode"))
                    throw new IOException("This release is no longer approved. Check for updates again.");
                verify(apk, candidate);
                if (!maintenanceActive()) throw new IOException("Return to Sparkade and reopen updates to continue.");
                if (!context.getPackageManager().canRequestPackageInstalls())
                    throw new IOException("Allow Sparkade to install updates, then retry.");
                for (PackageInstaller.SessionInfo old : installer.getMySessions()) installer.abandonSession(old.getSessionId());
                PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
                params.setAppPackageName(context.getPackageName());
                params.setSize(apk.length());
                id = installer.createSession(params);
                try (PackageInstaller.Session session = installer.openSession(id)) {
                    // Android 9's FileBridge stream must be closed exactly once, before commit.
                    try (InputStream input = new FileInputStream(apk);
                         OutputStream output = session.openWrite("base.apk", 0, apk.length())) {
                        byte[] buffer = new byte[64 * 1024]; int count;
                        while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                        session.fsync(output);
                    }
                    // A durable target lets the next process confirm replacement even if the callback dies with this process.
                    prefs.edit().putLong("installTarget", candidate.getLong("versionCode")).putString("state", "installing").commit();
                    Intent callback = new Intent(context, UpdateResultReceiver.class).setAction("dev.sparkade.kiosk.UPDATE_RESULT");
                    PendingIntent result = PendingIntent.getBroadcast(context, id, callback, PendingIntent.FLAG_UPDATE_CURRENT
                            | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0));
                    session.commit(result.getIntentSender());
                }
                message = "Confirm installation on the Android screen.";
            } catch (Exception error) {
                android.util.Log.w("SparkadeUpdate", "Install session failed", error);
                if (id != -1) installer.abandonSession(id);
                prefs.edit().putLong("installTarget", 0).apply();
                status("failed", error instanceof IOException ? error.getMessage() : "Android could not install this update. Please retry.");
            } finally { busy = false; }
        });
    }
    void installResult(int result, int platformResult) {
        if (result == PackageInstaller.STATUS_SUCCESS) status("updated", "Update installed. Opening Sparkade…");
        else {
            prefs.edit().putLong("installTarget", 0).apply();
            status("failed", UpdatePolicy.installFailure(result, platformResult));
        }
    }
    private void verify(File file, JSONObject expected) throws Exception {
        if (file.length() != expected.getLong("apkBytes") || !digest(file).equals(expected.getString("apkSha256")))
            throw new IOException("Update checksum mismatch. The installed app has not been changed.");
        PackageManager manager = context.getPackageManager();
        // Android 9's archive parser only collects certificates when GET_SIGNATURES is also set.
        // Keep SigningInfo for comparison; requesting both flags does not relax verification.
        PackageInfo archive = manager.getPackageArchiveInfo(file.getPath(),
                PackageManager.GET_SIGNING_CERTIFICATES | PackageManager.GET_SIGNATURES);
        PackageInfo installed = manager.getPackageInfo(context.getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
        String certificate = certificate(archive), current = certificate(installed);
        if (archive == null || archive.applicationInfo == null
                || !certificate.equals(expected.getString("signingCertificateSha256"))
                || !UpdatePolicy.archive(archive.packageName, archive.getLongVersionCode(), archive.versionName,
                    (archive.applicationInfo.flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0,
                    archive.applicationInfo.minSdkVersion, Build.VERSION.SDK_INT, certificate, current,
                    installed.getLongVersionCode(), expected.getLong("versionCode"), expected.getString("version")))
            throw new IOException("Update identity, signature, or version is invalid. The installed app has not been changed.");
    }
    private static String certificate(PackageInfo info) throws Exception {
        if (info == null || info.signingInfo == null || info.signingInfo.hasMultipleSigners()) return "";
        android.content.pm.Signature[] signatures = info.signingInfo.getApkContentsSigners();
        return signatures.length == 1 ? hex(MessageDigest.getInstance("SHA-256").digest(signatures[0].toByteArray())) : "";
    }
    private static String digest(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[64 * 1024]; int count;
            while ((count = input.read(buffer)) != -1) digest.update(buffer, 0, count);
        }
        return hex(digest.digest());
    }
    private static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder();
        for (byte value : bytes) result.append(String.format(java.util.Locale.US, "%02x", value & 255));
        return result.toString();
    }
    private static byte[] download(String url, File target, long limit, boolean missingAllowed) throws IOException {
        long deadline = SystemClock.elapsedRealtime() + 10 * 60_000;
        for (int redirects = 0; redirects < 5; redirects++) {
            if (!UpdatePolicy.downloadUrl(url)) throw new IOException("Unexpected update download address.");
            HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15_000); connection.setReadTimeout(30_000);
            connection.setRequestProperty("User-Agent", "SparkadePortal/" + BuildConfig.VERSION_NAME);
            try {
                int status = connection.getResponseCode();
                if (status >= 300 && status < 400) {
                    String next = connection.getHeaderField("Location");
                    if (next == null) throw new IOException("Missing update download address.");
                    url = new URL(new URL(url), next).toString(); continue;
                }
                if (missingAllowed && status == 404) return null;
                if (status != 200) throw new IOException("Update service unavailable (HTTP " + status + "). Please retry later.");
                if (connection.getContentLengthLong() > limit) throw new IOException("Update exceeds the download limit.");
                ByteArrayOutputStream memory = target == null ? new ByteArrayOutputStream() : null;
                try (InputStream input = connection.getInputStream(); OutputStream output = target == null ? memory : new FileOutputStream(target)) {
                    byte[] buffer = new byte[64 * 1024]; long total = 0; int count;
                    while ((count = input.read(buffer)) != -1) {
                        total += count;
                        if (total > limit || SystemClock.elapsedRealtime() > deadline) throw new IOException("Update download interrupted or too large. Please retry.");
                        output.write(buffer, 0, count);
                    }
                }
                return memory == null ? null : memory.toByteArray();
            } finally { connection.disconnect(); }
        }
        throw new IOException("Too many update redirects.");
    }
}
