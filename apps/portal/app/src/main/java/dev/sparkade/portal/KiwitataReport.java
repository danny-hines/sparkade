package dev.sparkade.portal;

/** Decoder pinned to the descriptor and reports observed on the 0079:0011 pad. */
final class KiwitataReport {
    static final String DESCRIPTOR = "05010904a101a10275089505150026ff00350046ff00093009300930093009318102750495012507463b0165140900814265007501950a2501450105091901290a81020600ff7501950a2501450109018102c0a1027508950446ff0026ff0009029102c0c0";

    static boolean supports(byte[] descriptor, int length) {
        if (length * 2 != DESCRIPTOR.length()) return false;
        for (int i = 0; i < length; i++) {
            if ((descriptor[i] & 0xff) != Integer.parseInt(DESCRIPTOR.substring(i * 2, i * 2 + 2), 16)) return false;
        }
        return true;
    }

    static String decode(byte[] report) {
        if (report == null || report.length != 8) return "null";
        // Five axis bytes precede a four-bit unused hat and ten button bits.
        // The first three axes are unused; only byte 3/4 changed in D-pad tests.
        int bits = ((report[5] & 0xff) >>> 4) | ((report[6] & 0x3f) << 4);
        StringBuilder json = new StringBuilder("{\"buttons\":[");
        for (int i = 0; i < 10; i++) {
            if (i > 0) json.append(',');
            json.append((bits & (1 << i)) != 0);
        }
        return json.append("],\"axes\":[").append(axis(report[3])).append(',')
                .append(axis(report[4])).append("]}").toString();
    }

    private static int axis(byte value) {
        int unsigned = value & 0xff;
        return unsigned < 64 ? -1 : unsigned > 191 ? 1 : 0;
    }
}
