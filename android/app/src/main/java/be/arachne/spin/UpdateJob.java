package be.arachne.spin;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Scanner;
import org.json.JSONObject;

/** Every ~15 min, also with the app closed: is there a newer web version on GitHub than the one the app runs?
 *  Then an Android notification "update klaar"; tapping it opens the app, which asks "Ja, nu updaten". */
public class UpdateJob extends JobService {
    static final String PREFS = "arachneUpdate", REPO = "KVR-CIBER/arachne-app", CHANNEL = "updates";
    private static final int JOB_ID = 6767;

    static void schedule(Context c) {
        JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (js.getPendingJob(JOB_ID) != null) return;
        js.schedule(new JobInfo.Builder(JOB_ID, new ComponentName(c, UpdateJob.class))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPeriodic(15 * 60 * 1000L).setPersisted(true).build());
    }

    static long remoteVersion() throws Exception {
        String sha = new JSONObject(get("https://api.github.com/repos/" + REPO + "/commits/main")).getString("sha");
        return new JSONObject(get("https://raw.githubusercontent.com/" + REPO + "/" + sha + "/www/manifest.json")).getLong("version");
    }

    private static String get(String u) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
        c.setConnectTimeout(10000); c.setReadTimeout(15000); c.setRequestProperty("User-Agent", "arachne-app");
        try (InputStream in = c.getInputStream(); Scanner s = new Scanner(in, "UTF-8").useDelimiter("\\A")) { return s.hasNext() ? s.next() : ""; }
    }

    /** Notify once per new version: current = what the app runs (set by the page), notified = last version we told about. */
    static void check(Context c) throws Exception {
        SharedPreferences p = c.getSharedPreferences(PREFS, MODE_PRIVATE);
        long v = remoteVersion();
        if (v <= p.getLong("current", 0) || v <= p.getLong("notified", 0)) return;
        notify(c, "ARACHNE: nieuwe versie klaar", "Tik om nu te updaten.");
        p.edit().putLong("notified", v).apply();
    }

    static void notify(Context c, String title, String text) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Updates", NotificationManager.IMPORTANCE_HIGH));
        Intent open = new Intent(c, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        android.app.Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new android.app.Notification.Builder(c, CHANNEL) : new android.app.Notification.Builder(c);
        nm.notify(67, b.setSmallIcon(R.drawable.ic_arachne_fg).setContentTitle(title).setContentText(text).setContentIntent(pi).setAutoCancel(true).build());
    }

    @Override
    public boolean onStartJob(JobParameters params) {
        new Thread(() -> {
            try { check(this); } catch (Exception e) { }
            jobFinished(params, false);
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) { return true; }
}
