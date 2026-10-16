package be.arachne.spin;

import android.Manifest;
import android.content.Intent;
import android.media.AudioManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Always-on listening for "hey spin" plus spoken answers, all on the device (Android speech recognizer + TTS).
 * Events: "partial" {text}, "final" {text}, "state" {listening}, "error" {code}.
 * Listening pauses while the tablet speaks, so it does not hear itself.
 */
@CapacitorPlugin(name = "Voice", permissions = {@Permission(strings = {Manifest.permission.RECORD_AUDIO}, alias = "mic")})
public class VoicePlugin extends Plugin {
    private final Handler main = new Handler(Looper.getMainLooper());
    private SpeechRecognizer rec;
    private TextToSpeech tts;
    private boolean ttsReady = false, wanted = false, speaking = false, muted = false;
    private String lang = "nl-BE";
    private final Map<String, PluginCall> pending = new HashMap<>();

    @Override
    public void load() {
        tts = new TextToSpeech(getContext(), status -> {
            ttsReady = status == TextToSpeech.SUCCESS;
            if (ttsReady) setTtsLang();
        });
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override public void onStart(String id) {}
            @Override public void onDone(String id) { finishedSpeaking(id); }
            @Override public void onError(String id) { finishedSpeaking(id); }
        });
    }

    private void setTtsLang() {
        Locale l = Locale.forLanguageTag(lang);
        if (tts.isLanguageAvailable(l) < TextToSpeech.LANG_AVAILABLE) l = Locale.forLanguageTag("nl-NL");
        tts.setLanguage(l);
    }

    private void finishedSpeaking(String id) {
        main.post(() -> {
            PluginCall c = pending.remove(id);
            if (c != null) c.resolve();
            if (pending.isEmpty()) { speaking = false; if (wanted) main.postDelayed(this::listen, 250); }
        });
    }

    // ------------------------------------------------------------------ listening
    @PluginMethod
    public void start(PluginCall call) {
        lang = call.getString("lang", "nl-BE");
        if (getPermissionState("mic") != PermissionState.GRANTED) { requestPermissionForAlias("mic", call, "micDone"); return; }
        begin(call);
    }

    @PermissionCallback
    private void micDone(PluginCall call) {
        if (getPermissionState("mic") == PermissionState.GRANTED) begin(call);
        else call.reject("Geen toegang tot de microfoon");
    }

    private void begin(PluginCall call) {
        main.post(() -> {
            if (!SpeechRecognizer.isRecognitionAvailable(getContext())) { call.reject("Geen spraakherkenning op dit toestel"); return; }
            if (ttsReady) setTtsLang();
            wanted = true; listen();
            call.resolve();
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        main.post(() -> { wanted = false; if (rec != null) { rec.destroy(); rec = null; } setMuted(false); state(false); call.resolve(); });
    }

    private void setMuted(boolean m) {
        // the recognizer beeps every time it starts; mute the system/notification streams while it listens
        if (m == muted) return; muted = m;
        try {
            AudioManager am = (AudioManager) getContext().getSystemService(android.content.Context.AUDIO_SERVICE);
            int dir = m ? AudioManager.ADJUST_MUTE : AudioManager.ADJUST_UNMUTE;
            am.adjustStreamVolume(AudioManager.STREAM_NOTIFICATION, dir, 0);
            am.adjustStreamVolume(AudioManager.STREAM_SYSTEM, dir, 0);
        } catch (Exception ignored) {}
    }

    private void listen() {
        if (!wanted || speaking) return;
        if (rec == null) {
            rec = SpeechRecognizer.createSpeechRecognizer(getContext());
            rec.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle b) { state(true); }
                @Override public void onBeginningOfSpeech() {}
                @Override public void onRmsChanged(float v) {}
                @Override public void onBufferReceived(byte[] b) {}
                @Override public void onEndOfSpeech() {}
                @Override public void onEvent(int t, Bundle b) {}
                @Override public void onPartialResults(Bundle b) { emit("partial", b); }
                @Override public void onResults(Bundle b) { emit("final", b); restart(150); }
                @Override public void onError(int code) {
                    // 6 = no speech timeout, 7 = no match: normal while waiting for "hey spin"
                    if (code != SpeechRecognizer.ERROR_NO_MATCH && code != SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                        JSObject o = new JSObject(); o.put("code", code); notifyListeners("error", o);
                    }
                    if (code == SpeechRecognizer.ERROR_RECOGNIZER_BUSY || code == SpeechRecognizer.ERROR_CLIENT) { rec.destroy(); rec = null; restart(600); }
                    else if (code == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) { wanted = false; state(false); }
                    else restart(code == SpeechRecognizer.ERROR_NETWORK || code == SpeechRecognizer.ERROR_SERVER ? 2000 : 150);
                }
            });
        }
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
        i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getContext().getPackageName());
        i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 900);
        setMuted(true);
        try { rec.startListening(i); } catch (Exception e) { rec.destroy(); rec = null; restart(800); }
    }

    private void restart(int ms) { main.postDelayed(() -> { if (wanted && !speaking) listen(); }, ms); }

    private void emit(String ev, Bundle b) {
        ArrayList<String> r = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (r == null || r.isEmpty()) return;
        JSObject o = new JSObject(); o.put("text", r.get(0));
        com.getcapacitor.JSArray all = new com.getcapacitor.JSArray(); for (String s : r) all.put(s); o.put("alts", all);
        notifyListeners(ev, o);
    }

    private void state(boolean on) { JSObject o = new JSObject(); o.put("listening", on); notifyListeners("state", o); }

    // ------------------------------------------------------------------ speaking
    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        if (!ttsReady || text.isEmpty()) { call.resolve(); return; }
        main.post(() -> {
            speaking = true;
            if (rec != null) rec.cancel();
            state(false); setMuted(false);
            String id = "u" + System.nanoTime();
            pending.put(id, call);
            Bundle p = new Bundle();
            tts.setSpeechRate((float) (double) call.getDouble("rate", 1.05));
            tts.setPitch((float) (double) call.getDouble("pitch", 0.9));
            tts.speak(text, TextToSpeech.QUEUE_ADD, p, id);
        });
    }

    @Override
    protected void handleOnDestroy() {
        wanted = false;
        if (rec != null) rec.destroy();
        if (tts != null) tts.shutdown();
        setMuted(false);
    }
}
