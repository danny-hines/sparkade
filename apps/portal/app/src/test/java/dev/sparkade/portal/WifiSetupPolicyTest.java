package dev.sparkade.portal;

import org.junit.Test;
import static org.junit.Assert.*;
import java.nio.charset.StandardCharsets;

public class WifiSetupPolicyTest {
    private String hex(String text) {
        StringBuilder result = new StringBuilder();
        for (byte b : text.getBytes(StandardCharsets.UTF_8)) result.append(String.format("%02x", b));
        return result.toString();
    }
    private String payload(String ssid, String key, String security) {
        return "SPARKADE_WIFI_V1\n" + security + "\n" + hex(ssid) + "\n" + hex(key) + "\n0\n" + "a".repeat(32) + "\n";
    }
    @Test public void preservesSpacesUnicodeAndShellCharactersWithoutInterpolation() throws Exception {
        String ssid = "Office café '$(x)'";
        WifiSetupPolicy policy = new WifiSetupPolicy(payload(ssid, "a'$(`x`) \\\"z", "wpa2"));
        assertEquals(hex(ssid), policy.ssidHex);
        assertEquals("\"a'$(`x`) \\\\\\\"z\"", policy.androidKey());
        assertFalse(policy.hidden);
    }
    @Test public void acceptsOpenAndRawPsk() throws Exception {
        assertEquals("", new WifiSetupPolicy(payload("Guest", "", "open")).password);
        String raw = new String(new char[64]).replace('\0', 'a');
        assertEquals(raw, new WifiSetupPolicy(payload("Guest", raw, "wpa2")).androidKey());
    }
    @Test public void rejectsMalformedInputWithoutReflectingSecrets() {
        String secret = "DO_NOT_LOG_THIS";
        for (String input : new String[]{payload("", secret, "wpa2"), payload("Guest", "short", "wpa2"),
                payload("Guest", secret, "open"), payload("Guest", secret, "enterprise"),
                payload("Guest\nInjected", secret, "wpa2"), payload("é".repeat(17), secret, "wpa2"),
                payload("Guest", secret, "wpa2") + "extra", "SPARKADE_WIFI_V1\nopen\nff\n\n0\n"}) {
            try { new WifiSetupPolicy(input); fail("Accepted invalid input"); }
            catch (Exception expected) { assertFalse(expected.toString().contains(secret)); }
        }
    }
}
