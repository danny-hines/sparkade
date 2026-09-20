package dev.sparkade.portal;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;

/** Bounded stdin protocol; credentials never belong in a URI, shell argument, or log. */
final class WifiSetupPolicy {
    final String ssidHex, password, security, requestId;
    final boolean hidden;

    WifiSetupPolicy(String payload) throws Exception {
        String[] fields = payload.split("\n", -1);
        if (payload.length() > 512 || fields.length != 7 || !fields[0].equals("SPARKADE_WIFI_V1")
                || !fields[6].isEmpty() || !fields[5].matches("[0-9a-f]{32}")
                || !(fields[1].equals("open") || fields[1].equals("wpa2"))
                || !(fields[4].equals("0") || fields[4].equals("1"))) throw invalid();
        String ssid = decode(fields[2]);
        if (fields[2].length() < 2 || fields[2].length() > 64 || hasControls(ssid)) throw invalid();
        password = decode(fields[3]);
        security = fields[1]; ssidHex = fields[2]; hidden = fields[4].equals("1"); requestId = fields[5];
        if (security.equals("open")) {
            if (!password.isEmpty()) throw invalid();
        } else if (!password.matches("[0-9a-fA-F]{64}")
                && !(password.length() >= 8 && password.length() <= 63 && password.matches("[ -~]+"))) throw invalid();
    }

    String androidKey() {
        return password.matches("[0-9a-fA-F]{64}") ? password
                : "\"" + password.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }
    private static boolean hasControls(String value) {
        for (int i = 0; i < value.length(); i++) if (Character.isISOControl(value.charAt(i))) return true;
        return false;
    }
    private static String decode(String value) throws Exception {
        if (value.length() % 2 != 0 || !value.matches("[0-9a-f]*")) throw invalid();
        byte[] bytes = new byte[value.length() / 2];
        for (int i = 0; i < bytes.length; i++) bytes[i] = (byte) Integer.parseInt(value.substring(i * 2, i * 2 + 2), 16);
        return StandardCharsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(bytes)).toString();
    }
    private static IllegalArgumentException invalid() { return new IllegalArgumentException("Invalid Wi-Fi setup input"); }
}
