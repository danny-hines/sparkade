package dev.sparkade.portal;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import android.util.Base64;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

/** Per-install credential, encrypted at rest; neither token nor key crosses the web bridge. */
final class DeviceIdentity {
    private static final String KEY_ALIAS = "sparkade-kiosk-identity-v1";
    private final AtomicFile file;
    private final SecretKey key;
    private JSONObject identity;

    DeviceIdentity(Context context) throws Exception {
        file = new AtomicFile(new File(context.getNoBackupFilesDir(), "kiosk-identity.enc"));
        KeyStore keys = KeyStore.getInstance("AndroidKeyStore");
        keys.load(null);
        if (!keys.containsAlias(KEY_ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        key = (SecretKey) keys.getKey(KEY_ALIAS, null);
        if (file.getBaseFile().exists()) {
            JSONObject envelope = new JSONObject(new String(file.readFully(), StandardCharsets.UTF_8));
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128,
                    Base64.decode(envelope.getString("iv"), Base64.NO_WRAP)));
            identity = new JSONObject(new String(cipher.doFinal(Base64.decode(
                    envelope.getString("data"), Base64.NO_WRAP)), StandardCharsets.UTF_8));
            if (!CloudPolicy.ORIGIN.equals(identity.getString("origin"))) throw new IllegalStateException("Kiosk origin changed");
        }
    }

    synchronized JSONObject get() { return identity; }

    synchronized JSONObject create() throws Exception {
        SecureRandom random = new SecureRandom();
        byte[] id = new byte[12], secret = new byte[32];
        random.nextBytes(id); random.nextBytes(secret);
        int flags = Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING;
        String credentialId = Base64.encodeToString(id, flags);
        JSONObject next = new JSONObject().put("origin", CloudPolicy.ORIGIN)
                .put("credentialId", credentialId)
                .put("token", "spk_kiosk_" + credentialId + "_" + Base64.encodeToString(secret, flags))
                .put("state", "unregistered");
        save(next);
        return next;
    }

    synchronized void save(JSONObject next) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key);
        byte[] encrypted = cipher.doFinal(next.toString().getBytes(StandardCharsets.UTF_8));
        JSONObject envelope = new JSONObject().put("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                .put("data", Base64.encodeToString(encrypted, Base64.NO_WRAP));
        FileOutputStream output = file.startWrite();
        try {
            output.write(envelope.toString().getBytes(StandardCharsets.UTF_8));
            file.finishWrite(output);
            identity = next;
        } catch (Exception error) { file.failWrite(output); throw error; }
    }
}
