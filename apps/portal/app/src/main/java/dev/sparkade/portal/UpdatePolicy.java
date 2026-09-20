package dev.sparkade.portal;

import java.net.URI;

/** Pure validation shared by download, archive inspection, and installation. */
final class UpdatePolicy {
    static final long MAX_APK_BYTES = 100L * 1024 * 1024;
    static final String RELEASE_BASE = "https://github.com/danny-hines/sparkade/releases/download/";
    static boolean channel(String value) { return "stable".equals(value) || "pilot".equals(value); }
    static boolean version(String value) { return value != null && value.matches("[0-9]+\\.[0-9]+\\.[0-9]+"); }
    static boolean hash(String value) { return value != null && value.matches("[a-f0-9]{64}"); }
    static String manifestUrl(String channel) {
        if (!channel(channel)) throw new IllegalArgumentException("Invalid update channel");
        return RELEASE_BASE + "portal-channel-" + channel + "/release.json";
    }
    static String apkUrl(String version) {
        if (!version(version)) throw new IllegalArgumentException("Invalid release version");
        return RELEASE_BASE + "portal-v" + version + "/sparkade-portal.apk";
    }
    static boolean downloadUrl(String value) {
        try {
            URI uri = new URI(value);
            String host = uri.getHost();
            return "https".equals(uri.getScheme()) && uri.getRawUserInfo() == null
                    && (uri.getPort() == -1 || uri.getPort() == 443) && uri.getFragment() == null
                    && ("github.com".equals(host) || "release-assets.githubusercontent.com".equals(host)
                    || "objects.githubusercontent.com".equals(host) || "github-releases.githubusercontent.com".equals(host));
        } catch (Exception error) { return false; }
    }
    static boolean archive(String packageName, long code, String version, boolean debug,
            int minSdk, int sdk, String certificate, String installedCertificate,
            long installedCode, long expectedCode, String expectedVersion) {
        return "dev.sparkade.kiosk".equals(packageName) && code > installedCode
                && code == expectedCode && version.equals(expectedVersion) && !debug
                && minSdk <= sdk && hash(certificate) && certificate.equals(installedCertificate);
    }
    static String installFailure(int status, int platformStatus) {
        // Platform PackageManager install result codes: verification timeout/failure.
        if (platformStatus == -21 || platformStatus == -22)
            return "The Portal's system app verifier blocked this update. Use the Mac installer or contact your Sparkade administrator.";
        return status == android.content.pm.PackageInstaller.STATUS_FAILURE_ABORTED
                ? "Installation cancelled. Check again when you are ready."
                : "Android did not install the update. Check again to retry.";
    }
    static boolean maintenance(String screen, long ageMs) {
        return ageMs >= 0 && ageMs < 6_000
                && ("attract".equals(screen) || "home".equals(screen) || "settings".equals(screen));
    }
}
