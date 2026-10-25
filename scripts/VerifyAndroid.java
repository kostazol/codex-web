// Run with JDK 17+ source-file mode and the pinned Google apksig JAR on the classpath.
import com.android.apksig.ApkVerifier;
import com.android.apksig.apk.ApkUtils;
import java.io.File;
import java.nio.ByteBuffer;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.zip.ZipFile;

class VerifyAndroid {
    private static String quote(String value) {
        return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 3) throw new IllegalArgumentException("apk packageName certificateSha256");
        File apk = new File(args[0]);
        String expected = args[2].replace(":", "").toUpperCase();
        var result = new ApkVerifier.Builder(apk).build().verify();
        var signers = new ArrayList<String>();
        boolean trusted = !result.getSignerCertificates().isEmpty();
        for (var cert : result.getSignerCertificates()) {
            String sha = HexFormat.of().withUpperCase().formatHex(
                MessageDigest.getInstance("SHA-256").digest(cert.getEncoded()));
            signers.add(quote(sha));
            trusted &= expected.equals(sha);
        }
        byte[] manifest;
        try (var zip = new ZipFile(apk)) {
            var entry = zip.getEntry("AndroidManifest.xml");
            if (entry == null || entry.getSize() > 8 * 1024 * 1024)
                throw new IllegalArgumentException("Missing or oversized AndroidManifest.xml");
            try (var input = zip.getInputStream(entry)) {
                manifest = input.readNBytes(8 * 1024 * 1024 + 1);
            }
            if (manifest.length > 8 * 1024 * 1024)
                throw new IllegalArgumentException("Oversized AndroidManifest.xml");
        }
        String name = ApkUtils.getPackageNameFromBinaryAndroidManifest(ByteBuffer.wrap(manifest));
        long version = ApkUtils.getLongVersionCodeFromBinaryAndroidManifest(ByteBuffer.wrap(manifest));
        boolean valid = result.isVerified() && trusted;
        boolean identity = valid && name.equals(args[1]);
        System.out.println("{\"signatureVerified\":" + valid
            + ",\"packageIdentityVerified\":" + identity
            + ",\"packageName\":" + quote(name)
            + ",\"versionCode\":" + version
            + ",\"minSdk\":" + ApkUtils.getMinSdkVersionFromBinaryAndroidManifest(ByteBuffer.wrap(manifest))
            + ",\"targetSdk\":" + ApkUtils.getTargetSdkVersionFromBinaryAndroidManifest(ByteBuffer.wrap(manifest))
            + ",\"signerSha256\":[" + String.join(",", signers) + "]"
            + ",\"v2\":" + result.isVerifiedUsingV2Scheme()
            + ",\"v3\":" + result.isVerifiedUsingV3Scheme()
            + ",\"verificationErrors\":" + result.getErrors().size() + "}");
        if (!identity) System.exit(2);
    }
}
