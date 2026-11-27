package app.maatik.android;

import android.app.Activity;
import android.content.ClipData;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.util.ArrayList;
import java.util.List;

/**
 * Maatik for Android: the maatik website in its own window, with the phone's camera
 * for photographing manuscript pages. The site does the work (login, cropping,
 * upload, proofreading); the app adds the camera and keeps the login.
 */
public class MainActivity extends Activity {
    static final String SITE = "https://pdara--maatik-web.us-east.modal.run/";
    static final String HOST = "pdara--maatik-web.us-east.modal.run";
    static final String OFFLINE = "file:///android_asset/offline.html";
    static final int REQ_FILES = 1;

    private WebView web;
    private ValueCallback<Uri[]> pendingFiles;
    private Uri cameraUri;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFFF4EFE6); // --paper
        web = new WebView(this);
        root.addView(web);
        setContentView(root);

        // Android 15 draws apps edge to edge: keep the page clear of the status and navigation bars.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            root.setOnApplyWindowInsetsListener((v, insets) -> {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return WindowInsets.CONSUMED;
            });
        }

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setUserAgentString(s.getUserAgentString() + " MaatikAndroid/0.1");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (HOST.equals(u.getHost()) || u.toString().startsWith("file:///android_asset/")) {
                    return false; // the site (and the offline page) stay in the app
                }
                // Anything else opens in the phone's browser.
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (Exception ignored) {
                }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    view.loadUrl(OFFLINE);
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                CookieManager.getInstance().flush(); // keep the login after the app is closed
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingFiles != null) {
                    pendingFiles.onReceiveValue(null);
                }
                pendingFiles = callback;
                try {
                    startActivityForResult(fileIntent(params), REQ_FILES);
                } catch (Exception e) {
                    pendingFiles = null;
                    return false;
                }
                return true;
            }
        });

        if (saved != null) {
            web.restoreState(saved);
        } else {
            web.loadUrl(SITE);
        }
    }

    /** "Take a photo" on the site opens the camera; "choose photos" offers the gallery and the camera. */
    private Intent fileIntent(WebChromeClient.FileChooserParams params) {
        Intent camera = cameraIntent();
        if (params.isCaptureEnabled() && camera != null) {
            return camera;
        }
        Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
        pick.addCategory(Intent.CATEGORY_OPENABLE);
        pick.setType("image/*");
        pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,
                params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE);
        Intent chooser = Intent.createChooser(pick, getString(R.string.choose_image));
        if (camera != null) {
            chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{camera});
        }
        return chooser;
    }

    /** The system camera, writing the full-size photo into Pictures/Maatik (also a backup in the gallery). */
    private Intent cameraIntent() {
        Intent take = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        if (take.resolveActivity(getPackageManager()) == null) {
            return null;
        }
        ContentValues v = new ContentValues();
        v.put(MediaStore.Images.Media.DISPLAY_NAME, "maatik_" + System.currentTimeMillis() + ".jpg");
        v.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
        v.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Maatik");
        cameraUri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
        if (cameraUri == null) {
            return null;
        }
        take.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
        take.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        return take;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_FILES || pendingFiles == null) {
            return;
        }
        List<Uri> picked = new ArrayList<>();
        if (resultCode == RESULT_OK) {
            ClipData clip = data != null ? data.getClipData() : null;
            if (clip != null) {
                for (int i = 0; i < clip.getItemCount(); i++) {
                    picked.add(clip.getItemAt(i).getUri());
                }
            } else if (data != null && data.getData() != null) {
                picked.add(data.getData());
            } else if (cameraUri != null) {
                picked.add(cameraUri); // the camera wrote the photo where we asked
            }
        }
        if (cameraUri != null && !picked.contains(cameraUri)) {
            // The camera was offered but not used: remove its empty gallery entry.
            try {
                getContentResolver().delete(cameraUri, null, null);
            } catch (Exception ignored) {
            }
        }
        cameraUri = null;
        pendingFiles.onReceiveValue(picked.isEmpty() ? null : picked.toArray(new Uri[0]));
        pendingFiles = null;
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }
}
