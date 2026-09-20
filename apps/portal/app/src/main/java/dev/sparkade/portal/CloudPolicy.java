package dev.sparkade.portal;

/** The web shell can request kiosk operations, never arbitrary authenticated URLs. */
final class CloudPolicy {
    static final String ORIGIN = "https://sparkade.dev";
    static final String LOCAL_ORIGIN = "https://appassets.androidplatform.net";
    static boolean gameId(String id) { return id != null && id.matches("g-[A-Za-z0-9_-]{1,100}"); }
    static boolean jobId(String id) { return id != null && id.matches("j-[A-Za-z0-9_-]{1,100}"); }
    static boolean asset(String name) { return name != null && name.matches("[a-z0-9][a-z0-9-]{0,100}\\.png"); }
    static boolean cloudRequest(String method, String path) {
        if (path == null) return false;
        if ("POST".equals(method)) return path.equals("/v1/jobs") || path.equals("/v1/sync")
                || path.equals("/v1/transcribe")
                || path.matches("/v1/jobs/j-[A-Za-z0-9_-]{1,100}/(retry|cancel)");
        return "GET".equals(method) && (path.matches("/v1/estimate(?:\\?(?:photo=[01]|archetype=[a-z]+)(?:&(?:photo=[01]|archetype=[a-z]+))*)?")
                || path.matches("/v1/jobs/j-[A-Za-z0-9_-]{1,100}/bundle")
                || path.matches("/v1/jobs/j-[A-Za-z0-9_-]{1,100}/assets/[a-z0-9][a-z0-9-]{0,100}\\.png"));
    }
}
