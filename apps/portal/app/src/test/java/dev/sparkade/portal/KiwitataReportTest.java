package dev.sparkade.portal;

import org.junit.Test;
import static org.junit.Assert.*;

public class KiwitataReportTest {
    private byte[] bytes(String hex) {
        byte[] result = new byte[hex.length() / 2];
        for (int i = 0; i < result.length; i++) result[i] = (byte) Integer.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        return result;
    }

    @Test public void capturedNeutralAndStartReportsDecodeWithoutPhantomAxes() {
        assertEquals("{\"buttons\":[false,false,false,false,false,false,false,false,false,false],\"axes\":[0,0]}",
                KiwitataReport.decode(bytes("017f7f7f7f0f0000")));
        assertEquals("{\"buttons\":[false,false,false,false,false,false,false,false,false,true],\"axes\":[0,0]}",
                KiwitataReport.decode(bytes("017f7f7f7f0f2000")));
        assertEquals("{\"buttons\":[false,true,false,false,false,false,false,false,false,false],\"axes\":[0,0]}",
                KiwitataReport.decode(bytes("017f7f7f7f2f0000")));
    }

    @Test public void capturedDpadDirectionsAndDiagonalDecode() {
        assertTrue(KiwitataReport.decode(bytes("017f7f007f0f0000")).endsWith("\"axes\":[-1,0]}"));
        assertTrue(KiwitataReport.decode(bytes("017f7fff7f0f0000")).endsWith("\"axes\":[1,0]}"));
        assertTrue(KiwitataReport.decode(bytes("017f7f7f000f0000")).endsWith("\"axes\":[0,-1]}"));
        assertTrue(KiwitataReport.decode(bytes("017f7f7fff0f0000")).endsWith("\"axes\":[0,1]}"));
        assertTrue(KiwitataReport.decode(bytes("017f7f00ff0f0000")).endsWith("\"axes\":[-1,1]}"));
    }

    @Test public void unknownDescriptorsAndShortReportsAreRejected() {
        byte[] descriptor = bytes(KiwitataReport.DESCRIPTOR);
        assertTrue(KiwitataReport.supports(descriptor, descriptor.length));
        descriptor[4] ^= 1;
        assertFalse(KiwitataReport.supports(descriptor, descriptor.length));
        assertFalse(KiwitataReport.supports(descriptor, -1));
        assertEquals("null", KiwitataReport.decode(new byte[7]));
        assertEquals("null", KiwitataReport.decode(null));
    }
}
