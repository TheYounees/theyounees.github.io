package az.jarvis.app;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.service.voice.VoiceInteractionSession;

/** Sistem asistanı işə düşəndə JARVIS pəncərəsini açır. */
public class JarvisSession extends VoiceInteractionSession {

    public JarvisSession(Context context) {
        super(context);
    }

    @Override
    public void onShow(Bundle args, int showFlags) {
        super.onShow(args, showFlags);
        try {
            Intent i = new Intent(getContext(), MainActivity.class);
            i.setAction(Intent.ACTION_ASSIST);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            getContext().startActivity(i);
            // Pəncərə açılsın, sonra sessiyanı bağlayırıq.
            new android.os.Handler(getContext().getMainLooper()).postDelayed(this::finish, 500);
        } catch (Exception ignored) {
            finish();
        }
    }
}
