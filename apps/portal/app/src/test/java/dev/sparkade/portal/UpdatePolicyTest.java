package dev.sparkade.portal;

import org.junit.Test;
import static org.junit.Assert.*;

public class UpdatePolicyTest {
    private final String cert = new String(new char[64]).replace('\0', 'a');
    @Test public void acceptsOnlyPinnedHttpsDownloadHosts() {
        assertTrue(UpdatePolicy.downloadUrl(UpdatePolicy.apkUrl("0.4.0")));
        assertTrue(UpdatePolicy.downloadUrl("https://release-assets.githubusercontent.com/github-production-release-asset/123?sig=123"));
        for (String url : new String[]{"http://github.com/file", "https://github.com.attacker.test/file", "https://github.com@attacker.test/file", "https://user:pass@github.com/file", "https://github.com:8080/file", "file:///data/app/base.apk", "https://example.com/file"})
            assertFalse(url, UpdatePolicy.downloadUrl(url));
    }
    @Test public void releasePathsCannotEscapeRepositoryOrSelectAnArbitraryFile() {
        assertEquals("https://github.com/danny-hines/sparkade/releases/download/portal-channel-stable/release.json", UpdatePolicy.manifestUrl("stable"));
        assertTrue(UpdatePolicy.version("0.4.0"));
        assertFalse(UpdatePolicy.version("../other"));
        assertFalse(UpdatePolicy.version("0.4.0?token=secret"));
        assertFalse(UpdatePolicy.channel("latest/../../other"));
        assertFalse(UpdatePolicy.hash("a"));
    }
    @Test public void refusesDowngradesDifferentPackagesDebugBuildsAndWrongCertificates() {
        assertTrue(archive("dev.sparkade.kiosk", 6, false, 28, cert));
        assertFalse(archive("dev.sparkade.kiosk", 5, false, 28, cert));
        assertFalse(archive("dev.sparkade.kiosk", 4, false, 28, cert));
        assertFalse(archive("dev.sparkade.portal", 6, false, 28, cert));
        assertFalse(archive("dev.sparkade.kiosk", 6, true, 28, cert));
        assertFalse(archive("dev.sparkade.kiosk", 6, false, 29, cert));
        assertFalse(archive("dev.sparkade.kiosk", 6, false, 28, cert.replace('a', 'b')));
    }
    private boolean archive(String name, long version, boolean debug, int sdk, String certificate) {
        return UpdatePolicy.archive(name, version, "0.4.0", debug, sdk, 28, certificate, cert, 5, 6, "0.4.0");
    }
    @Test public void maintenanceFailsClosedForActiveOrStaleSessions() {
        assertTrue(UpdatePolicy.maintenance("attract", 0));
        assertTrue(UpdatePolicy.maintenance("home", 1999));
        assertTrue(UpdatePolicy.maintenance("settings", 5999));
        for (String screen : new String[]{"play", "generation", "wizard", "remap", "unknown", ""}) assertFalse(UpdatePolicy.maintenance(screen, 0));
        assertFalse(UpdatePolicy.maintenance("home", 6000));
        assertFalse(UpdatePolicy.maintenance("home", -1));
    }
}
