package dev.sparkade.portal;

/** Both USB identity and the complete descriptor must match a supported pad. */
enum UsbControllerProfile {
    KIWITATA(0x0011, "Kiwitata"),
    ZERO_DELAY(0x0006, "Zero Delay");

    final int productId;
    final String label;
    UsbControllerProfile(int productId, String label) { this.productId = productId; this.label = label; }

    static UsbControllerProfile find(int vendorId, int productId) {
        if (vendorId != 0x0079) return null;
        for (UsbControllerProfile profile : values()) if (profile.productId == productId) return profile;
        return null;
    }

    boolean supports(byte[] descriptor, int length) {
        if (descriptor == null || length < 0 || length > descriptor.length) return false;
        return this == KIWITATA ? KiwitataReport.supports(descriptor, length)
                : ZeroDelayReport.supports(descriptor, length);
    }

    String decode(byte[] report) {
        return this == KIWITATA ? KiwitataReport.decode(report) : ZeroDelayReport.decode(report);
    }
}
