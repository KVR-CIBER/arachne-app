package be.arachne.spin;

import android.content.Context;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Iterator;

/** Web files update without a new APK (www/manifest.json lists every file with its sha256, published by publish.sh).
 *  download() builds the new version in files/live/<version>: unchanged files are copied from the version running now,
 *  changed ones fetched from GitHub and checked. Then it is persisted as Capacitor's server path, so the next start
 *  uses it; apply() switches right away. Installing a new APK falls back to the bundled files (Capacitor's own rule). */
@CapacitorPlugin(name = "LiveUpdate")
public class LiveUpdatePlugin extends Plugin {

    @PluginMethod
    public void download(PluginCall call) {
        String base = call.getString("base"), version = String.valueOf(call.getData().opt("version"));
        JSObject files = call.getObject("files");
        if (base == null || files == null) { call.reject("base en files nodig"); return; }
        String current = getBridge().getServerBasePath();
        new Thread(() -> {             // own thread: a 14 MB download must not hold up the USB plugin
            try {
                File dir = new File(getContext().getFilesDir(), "live/" + version), tmp = new File(dir.getPath() + ".tmp");
                delete(tmp);
                int fetched = 0, copied = 0;
                for (Iterator<String> it = files.keys(); it.hasNext(); ) {
                    String path = it.next(), sha = files.getString(path);
                    if (path.contains("..")) throw new Exception("ongeldig pad " + path);
                    File out = new File(tmp, path); out.getParentFile().mkdirs();
                    try (InputStream in = open(current, path)) { copy(in, out); }
                    catch (Exception e) { out.delete(); }
                    if (out.exists() && sha.equals(sha256(out))) { copied++; continue; }
                    HttpURLConnection c = (HttpURLConnection) new URL(base + path).openConnection();
                    c.setConnectTimeout(10000); c.setReadTimeout(30000);
                    try (InputStream in = c.getInputStream()) { copy(in, out); }
                    if (!sha.equals(sha256(out))) throw new Exception(path + " is beschadigd binnengekomen");
                    fetched++;
                }
                delete(dir);
                if (!tmp.renameTo(dir)) throw new Exception("kan de nieuwe versie niet opslaan");
                getContext().getSharedPreferences(com.getcapacitor.plugin.WebView.WEBVIEW_PREFS_NAME, Context.MODE_PRIVATE).edit()
                    .putString(com.getcapacitor.plugin.WebView.CAP_SERVER_PATH, dir.getPath()).apply();
                cleanup(dir);
                JSObject r = new JSObject(); r.put("path", dir.getPath()); r.put("fetched", fetched); r.put("copied", copied);
                call.resolve(r);
            } catch (Exception e) { call.reject(e.getMessage() == null ? e.toString() : e.getMessage()); }
        }).start();
    }

    /** The page tells which version it runs; schedules the background check (UpdateJob) and asks for notifications. */
    @PluginMethod
    public void setCurrent(PluginCall call) {
        long v = call.getData().optLong("version", 0);
        getContext().getSharedPreferences(UpdateJob.PREFS, Context.MODE_PRIVATE).edit().putLong("current", v).apply();
        UpdateJob.schedule(getContext());
        if (android.os.Build.VERSION.SDK_INT >= 33 && getActivity() != null
            && getContext().checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED)
            getActivity().requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 67);
        call.resolve();
    }

    @PluginMethod
    public void notifyNow(PluginCall call) {
        UpdateJob.notify(getContext(), call.getString("title", "ARACHNE"), call.getString("text", ""));
        call.resolve();
    }

    @PluginMethod
    public void apply(PluginCall call) {
        String path = call.getString("path");
        if (path == null || !new File(path, "index.html").exists()) { call.reject("geen geldige versie"); return; }
        call.resolve();
        getBridge().setServerBasePath(path);
    }

    private InputStream open(String current, String path) throws Exception {
        if (current != null && current.startsWith("/")) return new FileInputStream(new File(current, path));
        return getContext().getAssets().open((current == null || current.isEmpty() ? "public" : current) + "/" + path);
    }

    private void cleanup(File keep) {          // old versions: only the new one is kept
        File[] all = keep.getParentFile().listFiles();
        if (all != null) for (File f : all) if (!f.equals(keep)) delete(f);
    }

    private static void copy(InputStream in, File out) throws Exception {
        try (OutputStream o = new FileOutputStream(out)) { byte[] b = new byte[65536]; int n; while ((n = in.read(b)) > 0) o.write(b, 0, n); }
    }

    private static String sha256(File f) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(f)) { byte[] b = new byte[65536]; int n; while ((n = in.read(b)) > 0) md.update(b, 0, n); }
        StringBuilder s = new StringBuilder(); for (byte x : md.digest()) s.append(String.format("%02x", x));
        return s.toString();
    }

    private static void delete(File f) {
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) delete(k);
        f.delete();
    }
}
