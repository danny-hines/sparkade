package dev.sparkade.portal;

import org.junit.Test;
import static org.junit.Assert.*;

public class ZeroDelayReportTest {
    private byte[] bytes(String hex) {
        byte[] result = new byte[hex.length() / 2];
        for (int i = 0; i < result.length; i++) result[i] = (byte) Integer.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        return result;
    }

    private String expected(int bits, int x, int y) {
        StringBuilder value = new StringBuilder("{\"buttons\":[");
        for (int i = 0; i < 12; i++) {
            if (i > 0) value.append(',');
            value.append((bits & (1 << i)) != 0);
        }
        return value.append("],\"axes\":[").append(x).append(',').append(y).append("]}").toString();
    }

    @Test public void capturedNeutralReportsIgnoreUnwiredAxisNoise() {
        for (String report : new String[]{"7f7f7f7f7f0f00c0", "7f7f7e7f7f0f00c0", "7f7f787f7f0f00c0", "7f7f857f7f0f00c0"}) {
            assertEquals(expected(0, 0, 0), ZeroDelayReport.decode(bytes(report)));
        }
        assertEquals(expected(0, 0, 0), ZeroDelayReport.decode(bytes("7f7f00ff000f00ff")));
    }

    @Test public void everyDescriptorButtonIncludingElevenAndTwelveIsIndependent() {
        for (int i = 0; i < 12; i++) {
            byte[] report = bytes("7f7f7f7f7f0f00c0");
            report[5] = (byte) (15 | ((1 << i) << 4));
            report[6] = (byte) ((1 << i) >>> 4);
            assertEquals("button " + i, expected(1 << i, 0, 0), ZeroDelayReport.decode(report));
        }
        assertEquals(expected(4095, 0, 0), ZeroDelayReport.decode(bytes("7f7f7f7f7fffffc0")));
    }

    @Test public void capturedArcadeButtonReportsRetainTheHighButtonBits() {
        assertEquals(expected(1, 0, 0), ZeroDelayReport.decode(bytes("7f7f7f7f7f1f00c0")));
        assertEquals(expected(2, 0, 0), ZeroDelayReport.decode(bytes("7f7f807f7f2f00c0")));
        assertEquals(expected(64, 0, 0), ZeroDelayReport.decode(bytes("7f7f7f7f7f0f04c0")));
        assertEquals(expected(128, 0, 0), ZeroDelayReport.decode(bytes("7f7f807f7f0f08c0")));
        assertEquals(expected(256, 0, 0), ZeroDelayReport.decode(bytes("7f7f7f7f7f0f10c0")));
        assertEquals(expected(512, 0, 0), ZeroDelayReport.decode(bytes("7f7f7f7f7f0f20c0")));
        assertEquals(expected(1024, 0, 0), ZeroDelayReport.decode(bytes("7f7f7d7f7f0f40c0")));
        assertEquals(expected(2048, 0, 0), ZeroDelayReport.decode(bytes("7f7f7f7f7f0f80c0")));
    }

    @Test public void xyDirectionsHaveADeadZoneAndSupportDiagonals() {
        assertEquals(expected(0, -1, 0), ZeroDelayReport.decode(bytes("007f7f7f7f0f00c0")));
        assertEquals(expected(0, 1, 0), ZeroDelayReport.decode(bytes("ff7f7f7f7f0f00c0")));
        assertEquals(expected(0, 0, -1), ZeroDelayReport.decode(bytes("7f007f7f7f0f00c0")));
        assertEquals(expected(0, 0, 1), ZeroDelayReport.decode(bytes("7fff7f7f7f0f00c0")));
        assertEquals(expected(0, -1, 1), ZeroDelayReport.decode(bytes("00ff7f7f7f0f00c0")));
        assertEquals(expected(0, 0, 0), ZeroDelayReport.decode(bytes("40bf7f7f7f0f00c0")));
    }

    @Test public void descriptorHatDirectionsDoNotOverlapButtons() {
        int[][] directions = {{0,-1},{1,-1},{1,0},{1,1},{0,1},{-1,1},{-1,0},{-1,-1}};
        for (int hat = 0; hat < 16; hat++) {
            byte[] report = bytes("7f7f7f7f7f0f80c0");
            report[5] = (byte) hat;
            int[] axes = hat < 8 ? directions[hat] : new int[]{0, 0};
            assertEquals(expected(2048, axes[0], axes[1]), ZeroDelayReport.decode(report));
        }
    }

    @Test public void identityAndDescriptorMustBothMatchAndMalformedReportsReleaseInput() {
        assertEquals(UsbControllerProfile.ZERO_DELAY, UsbControllerProfile.find(0x79, 6));
        assertEquals(UsbControllerProfile.KIWITATA, UsbControllerProfile.find(0x79, 0x11));
        assertNull(UsbControllerProfile.find(0x79, 7));
        assertNull(UsbControllerProfile.find(0x80, 6));
        byte[] descriptor = bytes(ZeroDelayReport.DESCRIPTOR);
        assertTrue(UsbControllerProfile.ZERO_DELAY.supports(descriptor, descriptor.length));
        assertFalse(UsbControllerProfile.KIWITATA.supports(descriptor, descriptor.length));
        byte[] kiwitata = bytes(KiwitataReport.DESCRIPTOR);
        assertTrue(UsbControllerProfile.KIWITATA.supports(kiwitata, kiwitata.length));
        assertFalse(UsbControllerProfile.ZERO_DELAY.supports(kiwitata, kiwitata.length));
        descriptor[47] ^= 1;
        assertFalse(UsbControllerProfile.ZERO_DELAY.supports(descriptor, descriptor.length));
        assertFalse(ZeroDelayReport.supports(descriptor, -1));
        assertFalse(ZeroDelayReport.supports(descriptor, descriptor.length + 1));
        assertFalse(ZeroDelayReport.supports(null, 0));
        assertEquals("null", ZeroDelayReport.decode(null));
        assertEquals("null", ZeroDelayReport.decode(new byte[7]));
        assertEquals("null", ZeroDelayReport.decode(new byte[9]));
    }
}
