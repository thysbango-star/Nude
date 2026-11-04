package os.rovian.core

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import java.io.File
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec

/**
 * A small file encrypted with an AES-256-GCM key that lives in the Android Keystore (in secure hardware where the
 * phone has it). The key never leaves the Keystore; the file on disk is only ciphertext.
 */
class SecureFile(ctx: Context, private val alias: String, name: String) {
    private val file = File(ctx.filesDir, name)

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(alias, null) as? SecretKey)?.let { return it }
        val g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        g.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build())
        return g.generateKey()
    }

    /** True when the key is held in secure hardware (TEE or StrongBox); null if Android won't say. */
    fun hardwareBacked(): Boolean? = try {
        val k = key()
        val info = SecretKeyFactory.getInstance(k.algorithm, "AndroidKeyStore").getKeySpec(k, KeyInfo::class.java) as KeyInfo
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) info.securityLevel != KeyProperties.SECURITY_LEVEL_SOFTWARE
        else @Suppress("DEPRECATION") info.isInsideSecureHardware
    } catch (e: Exception) { null }

    fun exists() = file.exists()

    /** The text, or null if there's none. Throws if the file can't be decrypted (e.g. the key was reset). */
    fun read(): String? {
        if (!file.exists()) return null
        val raw = Base64.getDecoder().decode(file.readText())
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, raw, 0, 12))
        return String(c.doFinal(raw, 12, raw.size - 12), Charsets.UTF_8)
    }

    fun write(text: String) {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key())
        val out = c.iv + c.doFinal(text.toByteArray(Charsets.UTF_8))
        val tmp = File(file.path + ".tmp")
        tmp.writeText(Base64.getEncoder().encodeToString(out))
        if (!tmp.renameTo(file)) { file.delete(); tmp.renameTo(file) }
    }

    fun delete() { file.delete() }
}
