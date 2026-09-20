package dev.sparkade.portal;

import org.junit.Test;
import static org.junit.Assert.*;

public class CloudPolicyTest {
    @Test public void permitsOnlyKioskProtocol() {
        assertTrue(CloudPolicy.cloudRequest("POST", "/v1/jobs"));
        assertTrue(CloudPolicy.cloudRequest("GET", "/v1/estimate?photo=1&archetype=shooter"));
        assertTrue(CloudPolicy.cloudRequest("GET", "/v1/jobs/j-abc/assets/story-intro.png"));
        assertTrue(CloudPolicy.cloudRequest("POST", "/v1/jobs/j-abc/cancel"));
        for (String path : new String[]{"https://evil.example/v1/jobs", "//evil.example/v1/jobs",
                "/api/generation/session", "/api/kiosk/registration", "/v1/jobs/../secret",
                "/v1/jobs/j-abc/assets/../../secret", "/v1/jobs/j-abc/assets/%2e%2e.png",
                "/v1/estimate?redirect=https://evil.example", "/v1/jobs#fragment"}) {
            assertFalse(path, CloudPolicy.cloudRequest("GET", path));
            assertFalse(path, CloudPolicy.cloudRequest("POST", path));
        }
        assertFalse(CloudPolicy.cloudRequest("DELETE", "/v1/jobs"));
    }
    @Test public void rejectsFilesystemEscapesAndPrivateAssets() {
        assertTrue(CloudPolicy.asset("fighter-player-atlas.png"));
        assertTrue(CloudPolicy.gameId("g-example"));
        assertFalse(CloudPolicy.asset(".reference.png"));
        assertFalse(CloudPolicy.asset("../key-art.png"));
        assertFalse(CloudPolicy.gameId("../kiosk-identity.enc"));
    }
}
