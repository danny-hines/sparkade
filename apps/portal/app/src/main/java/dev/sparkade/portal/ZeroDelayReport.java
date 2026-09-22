package dev.sparkade.portal;

/** DragonRise 0079:0006 encoder; layout pinned to its captured HID descriptor. */
final class ZeroDelayReport {
    static final String DESCRIPTOR = "05010904a101a10275089505150026ff00350046ff00093009310932093209358102750495012507463b0165140939814265007501950c2501450105091901290c81020600ff750195082501450109018102c0a1027508950746ff0026ff0009029102c0c0";

    static boolean supports(byte[] descriptor, int length) {
        if (descriptor == null || length < 0 || length > descriptor.length
                || length * 2 != DESCRIPTOR.length()) return false;
        for (int i = 0; i < length; i++) {
            if ((descriptor[i] & 0xff) != Integer.parseInt(DESCRIPTOR.substring(i * 2, i * 2 + 2), 16)) return false;
        }
        return true;
    }

    static String decode(byte[] report) {
        if (report == null || report.length != 8) return "null";
        // X/Y are the first two bytes. Z/Z/Rz and the last vendor byte are not
        // arcade directions; the unused Z input jitters even with nothing held.
        int x = axis(report[0]), y = axis(report[1]);
        int hat = report[5] & 0x0f;
        // Some modes expose the stick as a hat. Its descriptor specifies 0..7;
        // all other values are neutral and leave X/Y in control.
        if (hat <= 7) {
            x = hat >= 1 && hat <= 3 ? 1 : hat >= 5 && hat <= 7 ? -1 : 0;
            y = hat == 0 || hat == 1 || hat == 7 ? -1 : hat >= 3 && hat <= 5 ? 1 : 0;
        }
        int bits = ((report[5] & 0xff) >>> 4) | ((report[6] & 0xff) << 4);
        StringBuilder json = new StringBuilder("{\"buttons\":[");
        for (int i = 0; i < 12; i++) {
            if (i > 0) json.append(',');
            json.append((bits & (1 << i)) != 0);
        }
        return json.append("],\"axes\":[").append(x).append(',').append(y).append("]}").toString();
    }

    private static int axis(byte value) {
        int unsigned = value & 0xff;
        return unsigned < 64 ? -1 : unsigned > 191 ? 1 : 0;
    }
}
