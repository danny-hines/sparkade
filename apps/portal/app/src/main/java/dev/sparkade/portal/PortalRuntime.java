package dev.sparkade.portal;

import android.content.Context;
import android.os.Build;
import android.util.AtomicFile;
import android.util.Base64;
import android.webkit.WebResourceResponse;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/** Device storage and authenticated, fixed-origin cloud operations for the packaged shell. */
final class PortalRuntime {
    private static PortalRuntime instance;
    static synchronized PortalRuntime get(Context context) throws Exception {
        if (instance == null) instance = new PortalRuntime(context.getApplicationContext());
        return instance;
    }
    private static final int JSON_LIMIT = 16 * 1024 * 1024;
    private static final int ASSET_LIMIT = 16 * 1024 * 1024;
    private final Context context;
    private final DeviceIdentity identity;
    private final File games;
    private final AtomicFile state;
    private String sessionToken;
    private long sessionExpires;

    private PortalRuntime(Context context) throws Exception {
        this.context = context.getApplicationContext();
        identity = new DeviceIdentity(context);
        games = new File(context.getFilesDir(), "games");
        if (!games.exists() && !games.mkdirs()) throw new IOException("Cannot create game storage");
        state = new AtomicFile(new File(context.getFilesDir(), "runtime-state.json"));
    }

    Object execute(String operation, JSONObject args) throws Exception {
        switch (operation) {
            case "state.load": return readState();
            case "state.save": saveState(args.getJSONObject("state")); return new JSONObject().put("ok", true);
            case "registration.status": return registration(false, false);
            case "registration.pair": return registration(true, args.optBoolean("force"));
            case "cloud": {
                String path = args.getString("path"), method = args.optString("method", "GET");
                if (!CloudPolicy.cloudRequest(method, path)) throw new IOException("Unsupported cloud operation");
                String mime = "application/json";
                byte[] body = null;
                if (args.has("form")) {
                    String boundary = "sparkade-" + java.util.UUID.randomUUID();
                    body = multipart(args.getJSONObject("form"), boundary);
                    mime = "multipart/form-data; boundary=" + boundary;
                } else if (args.has("body")) body = args.get("body").toString().getBytes(StandardCharsets.UTF_8);
                HttpResult result = cloud(path, method, mime, body, JSON_LIMIT);
                return new JSONObject().put("status", result.status).put("body", result.text());
            }
            case "game.install": install(args); return new JSONObject().put("ok", true);
            case "game.read": {
                String id = args.getString("gameId");
                if (!CloudPolicy.gameId(id)) throw new IOException("Invalid game id");
                File bundle = new File(new File(games, id), "bundle.json");
                return bundle.exists() ? new JSONObject(new String(readFile(bundle, JSON_LIMIT), StandardCharsets.UTF_8)) : JSONObject.NULL;
            }
            case "game.remove": {
                String id = args.getString("gameId");
                if (!CloudPolicy.gameId(id)) throw new IOException("Invalid game id");
                deleteTree(new File(games, id));
                return new JSONObject().put("ok", true);
            }
            case "device.info": return new JSONObject().put("model", Build.MODEL)
                    .put("version", BuildConfig.VERSION_NAME).put("diskFreeBytes", games.getUsableSpace())
                    .put("diskTotalBytes", games.getTotalSpace());
            default: throw new IOException("Unsupported Portal operation");
        }
    }

    private synchronized Object readState() throws Exception {
        return state.getBaseFile().exists() ? new JSONObject(new String(state.readFully(), StandardCharsets.UTF_8)) : JSONObject.NULL;
    }
    private synchronized void saveState(JSONObject value) throws Exception {
        byte[] bytes = value.toString().getBytes(StandardCharsets.UTF_8);
        if (bytes.length > JSON_LIMIT || value.optInt("version") != 1) throw new IOException("Invalid device state");
        atomicWrite(state, bytes);
    }
    static void atomicWrite(AtomicFile file, byte[] bytes) throws IOException {
        FileOutputStream output = file.startWrite();
        try { output.write(bytes); file.finishWrite(output); }
        catch (IOException error) { file.failWrite(output); throw error; }
    }

    private synchronized JSONObject registration(boolean pair, boolean force) throws Exception {
        JSONObject stored = identity.get();
        if (pair && (stored == null || force || "revoked".equals(stored.optString("state")))) {
            stored = identity.create(); sessionToken = null; sessionExpires = 0;
        }
        if (stored == null) return new JSONObject().put("state", "unregistered").put("origin", CloudPolicy.ORIGIN);
        try {
            if (pair && !"registered".equals(stored.optString("state"))) {
                JSONObject body = new JSONObject().put("credentialId", stored.getString("credentialId"))
                        .put("secretHash", sha256(stored.getString("token").getBytes(StandardCharsets.UTF_8)));
                HttpResult response = network("/api/kiosk/pairings", "POST", null, "application/json",
                        body.toString().getBytes(StandardCharsets.UTF_8), JSON_LIMIT);
                requireSuccess(response);
                JSONObject result = new JSONObject(response.text());
                stored.put("state", "pairing").put("pairingCode", result.getString("code"))
                        .put("expiresAt", result.getString("expiresAt"));
            } else {
                HttpResult response = network("/api/kiosk/registration", "GET", stored.getString("token"), null, null, JSON_LIMIT);
                requireSuccess(response);
                JSONObject result = new JSONObject(response.text());
                String status = result.getString("state");
                if (!status.matches("registered|pending|expired|revoked|unregistered")) throw new IOException("Invalid registration response");
                stored.put("state", status.equals("pending") ? "pairing" : status);
                for (String key : new String[]{"pairingCode", "expiresAt", "name", "kioskId", "defaultFeedVisibility"}) stored.remove(key);
                if (status.equals("pending")) stored.put("pairingCode", result.getString("code")).put("expiresAt", result.getString("expiresAt"));
                if (status.equals("registered")) {
                    stored.put("name", result.getString("name")).put("kioskId", result.getString("kioskId"))
                            .put("defaultFeedVisibility", result.getString("defaultFeedVisibility"));
                } else { sessionToken = null; sessionExpires = 0; }
            }
            identity.save(stored);
            return publicStatus(stored);
        } catch (IOException error) {
            return publicStatus(stored).put("state", "error").put("message", error.getMessage());
        }
    }
    private JSONObject publicStatus(JSONObject stored) throws Exception {
        JSONObject result = new JSONObject().put("origin", CloudPolicy.ORIGIN).put("state", stored.getString("state"));
        for (String key : new String[]{"pairingCode", "expiresAt", "name", "defaultFeedVisibility"}) {
            if (stored.has(key)) result.put(key, stored.get(key));
        }
        return result;
    }
    private synchronized String session() throws Exception {
        if (sessionToken != null && sessionExpires > System.currentTimeMillis() + 30_000) return sessionToken;
        JSONObject stored = identity.get();
        if (stored == null || !"registered".equals(stored.optString("state"))) throw new IOException("Register this Portal in Settings → Cloud before creating games.");
        HttpResult response = network("/api/generation/session", "POST", stored.getString("token"), null, null, JSON_LIMIT);
        requireSuccess(response);
        JSONObject payload = new JSONObject(response.text());
        // Never forward either credential to a redirected or server-selected host.
        if (!CloudPolicy.ORIGIN.equals(payload.getString("origin"))) throw new IOException("Unexpected generation service origin");
        sessionToken = payload.getString("token"); sessionExpires = payload.getLong("expiresAt");
        return sessionToken;
    }
    private HttpResult cloud(String path, String method, String mime, byte[] body, int limit) throws Exception {
        if (!CloudPolicy.cloudRequest(method, path)) throw new IOException("Unsupported cloud operation");
        for (int attempt = 0; attempt < 2; attempt++) {
            HttpResult result = network(path, method, session(), mime, body, limit);
            if (result.status != 401 || attempt == 1) return result;
            synchronized (this) { sessionToken = null; sessionExpires = 0; }
        }
        throw new IOException("Cloud authentication failed");
    }
    private static final class HttpResult {
        final int status; final byte[] bytes; final String mime;
        HttpResult(int status, byte[] bytes, String mime) { this.status = status; this.bytes = bytes; this.mime = mime; }
        String text() { return new String(bytes, StandardCharsets.UTF_8); }
    }
    private HttpResult network(String path, String method, String token, String mime, byte[] body, int limit) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(CloudPolicy.ORIGIN + path).openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(10_000);
        connection.setReadTimeout(path.startsWith("/api/kiosk/") ? 10_000 : 120_000);
        connection.setRequestMethod(method);
        connection.setRequestProperty("Accept", "application/json");
        if (token != null) connection.setRequestProperty("Authorization", "Bearer " + token);
        try {
            if (body != null) {
                connection.setDoOutput(true); connection.setRequestProperty("Content-Type", mime);
                connection.setFixedLengthStreamingMode(body.length);
                try (OutputStream output = connection.getOutputStream()) { output.write(body); }
            }
            int status = connection.getResponseCode();
            if (status >= 300 && status < 400) throw new IOException("Unexpected cloud redirect");
            InputStream stream = status < 400 ? connection.getInputStream() : connection.getErrorStream();
            byte[] bytes = stream == null ? new byte[0] : readBounded(stream, limit);
            return new HttpResult(status, bytes, connection.getContentType());
        } finally { connection.disconnect(); }
    }
    private void requireSuccess(HttpResult result) throws IOException {
        if (result.status >= 200 && result.status < 300) return;
        String message = "Cloud request failed (HTTP " + result.status + "). Please retry.";
        try { message = new JSONObject(result.text()).optString("error", message); } catch (Exception ignored) {}
        throw new IOException(message.substring(0, Math.min(message.length(), 400)));
    }
    private byte[] multipart(JSONObject form, String boundary) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        JSONObject fields = form.optJSONObject("fields");
        if (fields != null) {
            java.util.Iterator<String> keys = fields.keys();
            while (keys.hasNext()) {
                String name = keys.next();
                if (!name.equals("input")) throw new IOException("Unsupported upload field");
                output.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + name + "\"\r\n\r\n" + fields.getString(name) + "\r\n").getBytes(StandardCharsets.UTF_8));
            }
        }
        JSONObject file = form.optJSONObject("file");
        if (file != null) {
            String name = file.getString("name");
            String mime = file.getString("mime").split(";", 2)[0].trim();
            if (!(name.equals("audio") && mime.matches("audio/(webm|wav|x-wav|ogg|mp4|mpeg)")
                    || name.equals("photo") && mime.equals("image/jpeg"))) throw new IOException("Unsupported media upload");
            byte[] data = Base64.decode(file.getString("base64"), Base64.DEFAULT);
            if (data.length > 12 * 1024 * 1024) throw new IOException("Recording or photo is too large");
            output.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + name
                    + "\"; filename=\"recording" + (name.equals("photo") ? ".jpg" : ".webm")
                    + "\"\r\nContent-Type: " + mime + "\r\n\r\n").getBytes(StandardCharsets.UTF_8));
            output.write(data); output.write("\r\n".getBytes(StandardCharsets.UTF_8));
        }
        output.write(("--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
        return output.toByteArray();
    }

    /** Downloads are bounded, hashed, and staged; bundle.json is the commit marker. */
    private void install(JSONObject args) throws Exception {
        String job = args.getString("jobId"), game = args.getString("gameId");
        JSONObject bundle = args.getJSONObject("bundle");
        if (!CloudPolicy.jobId(job) || !CloudPolicy.gameId(game)
                || !game.equals(bundle.getJSONObject("meta").getString("id"))) throw new IOException("Invalid bundle identity");
        JSONArray assets = bundle.getJSONObject("manifest").getJSONArray("assets");
        if (assets.length() > 200) throw new IOException("Too many game assets");
        File directory = new File(games, game), assetsDir = new File(directory, "assets");
        if (!assetsDir.exists() && !assetsDir.mkdirs()) throw new IOException("Cannot create game directory");
        HashSet<String> names = new HashSet<>();
        long total = 0;
        for (int i = 0; i < assets.length(); i++) {
            JSONObject asset = assets.getJSONObject(i);
            String name = asset.getString("filename"), hash = asset.getString("sha256");
            if (!CloudPolicy.asset(name) || !hash.matches("[a-f0-9]{64}") || !names.add(name)) throw new IOException("Invalid asset manifest");
            File target = new File(assetsDir, name);
            if (target.exists() && sha256(readFile(target, ASSET_LIMIT)).equals(hash)) {
                total += target.length();
                if (total > 256L * 1024 * 1024) throw new IOException("Game exceeds download limit");
                continue;
            }
            if (games.getUsableSpace() < ASSET_LIMIT * 2L) throw new IOException("Portal storage is full. Remove a game and retry.");
            HttpResult response = cloud("/v1/jobs/" + job + "/assets/" + name, "GET", null, null, ASSET_LIMIT);
            requireSuccess(response);
            total += response.bytes.length;
            if (total > 256L * 1024 * 1024) throw new IOException("Game exceeds download limit");
            if (!sha256(response.bytes).equals(hash)) throw new IOException("Asset checksum mismatch. Retry the download.");
            atomicWrite(new AtomicFile(target), response.bytes);
        }
        atomicWrite(new AtomicFile(new File(directory, "bundle.json")), bundle.toString().getBytes(StandardCharsets.UTF_8));
    }

    WebResourceResponse asset(String path) {
        // Called only for the packaged origin. Never expose the private root or identity file.
        String[] parts = path.split("/");
        if (parts.length != 6 || !parts[1].equals("api") || !parts[4].equals("assets") || !CloudPolicy.asset(parts[5])) return null;
        try {
            if (parts[2].equals("games") && CloudPolicy.gameId(parts[3])) {
                File dir = new File(games, parts[3]);
                if (!new File(dir, "bundle.json").exists()) return null;
                return new WebResourceResponse("image/png", null, new FileInputStream(new File(new File(dir, "assets"), parts[5])));
            }
            if (parts[2].equals("jobs") && CloudPolicy.jobId(parts[3])) {
                HttpResult response = cloud("/v1/jobs/" + parts[3] + "/assets/" + parts[5], "GET", null, null, ASSET_LIMIT);
                if (response.status == 200) return new WebResourceResponse("image/png", null, new ByteArrayInputStream(response.bytes));
            }
        } catch (Exception ignored) { /* A missing preview never interrupts the game shell. */ }
        return null;
    }
    static byte[] readFile(File file, int limit) throws IOException { return readBounded(new FileInputStream(file), limit); }
    private static byte[] readBounded(InputStream stream, int limit) throws IOException {
        try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[16 * 1024]; int count;
            while ((count = input.read(buffer)) != -1) {
                if (output.size() + count > limit) throw new IOException("Cloud response exceeds size limit");
                output.write(buffer, 0, count);
            }
            return output.toByteArray();
        }
    }
    static String sha256(byte[] bytes) throws Exception {
        StringBuilder result = new StringBuilder();
        for (byte b : MessageDigest.getInstance("SHA-256").digest(bytes)) result.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
        return result.toString();
    }
    private static void deleteTree(File file) throws IOException {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteTree(child);
        if (file.exists() && !file.delete()) throw new IOException("Could not remove game files");
    }
}
