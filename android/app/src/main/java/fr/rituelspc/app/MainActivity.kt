package fr.rituelspc.app

import android.content.Intent
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.PopupMenu
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import java.util.concurrent.Executors

/**
 * Coquille native : associe le téléphone au PC, l'allume par Wake-on-LAN, attend son démarrage,
 * lance éventuellement un mode, puis affiche l'interface web de Rituels PC.
 */
class MainActivity : AppCompatActivity() {
    private enum class Screen { NONE, CHECKING, UNPAIRED, OFFLINE, WEB }

    private lateinit var prefs: Prefs
    private lateinit var root: FrameLayout
    private val ui = Handler(Looper.getMainLooper())
    private val io = Executors.newCachedThreadPool()
    private var screen = Screen.NONE
    private var webView: WebView? = null
    private var routeId = 0
    private var wakeId = 0
    private var waking = false

    private val scanner = registerForActivityResult(ScanContract()) { result ->
        result.contents?.let { onScanned(it) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        CookieManager.getInstance().setAcceptCookie(true)
        root = FrameLayout(this)
        setContentView(root)
        WindowCompat.getInsetsController(window, root).isAppearanceLightStatusBars = false
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val web = webView
                if (screen == Screen.WEB && web != null && web.canGoBack()) {
                    web.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })
    }

    override fun onResume() {
        super.onResume()
        if (screen != Screen.WEB && !waking) route()
    }

    override fun onDestroy() {
        wakeId++
        webView?.destroy()
        super.onDestroy()
    }

    // ---------- navigation entre les écrans ----------

    /** Décide quoi afficher : association, PC éteint, ou interface du PC. */
    private fun route() {
        val pc = prefs.pc
        if (pc == null) {
            showUnpaired(null)
            return
        }
        val id = ++routeId
        showChecking(pc)
        io.execute {
            val session = runCatching { PcClient(pc).session() }.getOrNull()
            ui.post {
                if (id == routeId) {
                    when {
                        session == null -> showOffline(prefs.pc ?: pc)
                        !session.authed -> showUnpaired("L'association avec ${pc.name} n'est plus valable : scannez à nouveau le QR code.")
                        else -> showWeb(prefs.pc ?: pc)
                    }
                }
            }
            if (session?.authed == true) refreshCache(pc)
        }
    }

    /** Mémorise la MAC et les noms des modes pour pouvoir allumer le PC et choisir un mode quand il est éteint. */
    private fun refreshCache(pc: Pc) {
        runCatching {
            val client = PcClient(pc)
            val mac = client.status().optString("mac")
            if (WakeOnLan.parseMac(mac) != null && mac != pc.mac) prefs.pc = pc.copy(mac = mac)
            val array = client.modes()
            prefs.modes = (0 until array.length()).map {
                val o = array.getJSONObject(it)
                Mode(o.getString("id"), o.getString("name"), o.optString("icon", "⚡"))
            }
        }
    }

    private fun showChecking(pc: Pc) {
        enter(Screen.CHECKING)
        setScreen(column(label("⚡", 56f), label(pc.name, 20f, bold = true), ProgressBar(this)))
    }

    private fun showUnpaired(message: String?) {
        enter(Screen.UNPAIRED)
        setScreen(scroll(column(
            label("⚡", 56f),
            label("Rituels PC", 24f, bold = true),
            label("Sur le PC, ouvrez Rituels PC › Contrôle › Associer un téléphone, puis scannez le QR code.", 15f, DIM),
            message?.let { label(it, 14f, ERR) },
            button("Scanner le QR code", primary = true) {
                scanner.launch(ScanOptions().setBeepEnabled(false).setOrientationLocked(false)
                    .setDesiredBarcodeFormats(ScanOptions.QR_CODE).setPrompt("Scannez le QR code de Rituels PC"))
            },
            button("Saisir le code à la main") { manualPairing() },
        )))
    }

    private fun showOffline(pc: Pc) {
        enter(Screen.OFFLINE)
        val modes = prefs.modes
        val status = label("", 14f, DIM)
        val spinner = Spinner(this).apply {
            adapter = ArrayAdapter(
                this@MainActivity, android.R.layout.simple_spinner_dropdown_item,
                listOf("Aucun (juste allumer)") + modes.map { "${it.icon} ${it.name}" },
            )
            setSelection(modes.indexOfFirst { it.id == prefs.wakeMode } + 1)
            onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
                override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                    prefs.wakeMode = if (position == 0) "" else modes[position - 1].id
                }

                override fun onNothingSelected(parent: AdapterView<*>?) {}
            }
        }
        val cancel = button("Annuler") { cancelWake(); route() }.apply { visibility = View.GONE }
        val power = label("⏻", 64f).apply {
            background = round(ACCENT, dp(80))
            layoutParams = LinearLayout.LayoutParams(dp(150), dp(150)).apply { gravity = Gravity.CENTER_HORIZONTAL; topMargin = dp(20) }
        }
        power.setOnClickListener { startWake(pc, status, power, cancel) }
        setScreen(scroll(column(
            label(pc.name, 22f, bold = true),
            label("Éteint ou injoignable", 15f, DIM),
            power,
            label("Allumer le PC", 16f, bold = true),
            label("Puis lancer :", 14f, DIM),
            spinner,
            status,
            cancel,
            button("Réessayer") { route() },
            button("Oublier ce PC") { confirm("Oublier ${pc.name} ?") { forget() } },
        )))
    }

    private fun showWeb(pc: Pc) {
        enter(Screen.WEB)
        val web = WebView(this).apply {
            setBackgroundColor(BG)
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                allowFileAccess = false
                allowContentAccess = false
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            }
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val url = request.url
                    if (url.host == pc.host && url.port == pc.port) return false
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, url)) }
                    return true
                }

                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                    if (request.isForMainFrame) route() // le PC s'est éteint ou a changé d'adresse
                }
            }
            loadUrl(pc.base)
        }
        webView = web
        val more = label("⋮", 24f).apply { setPadding(dp(16), dp(8), dp(16), dp(8)) }
        more.setOnClickListener {
            PopupMenu(this, more).apply {
                menu.add("Actualiser")
                menu.add("Oublier ce PC")
                setOnMenuItemClickListener { item ->
                    if (item.title.toString() == "Actualiser") web.reload() else confirm("Oublier ${pc.name} ?") { forget() }
                    true
                }
            }.show()
        }
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(CARD)
            setPadding(dp(16), dp(2), dp(4), dp(2))
            addView(label(pc.name, 15f, bold = true, center = false), LinearLayout.LayoutParams(0, WRAP, 1f))
            addView(more)
        }
        setScreen(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(bar, LinearLayout.LayoutParams(MATCH, WRAP))
            addView(web, LinearLayout.LayoutParams(MATCH, 0, 1f))
        })
    }

    // ---------- allumage ----------

    private fun startWake(pc: Pc, status: TextView, power: View, cancel: View) {
        if (WakeOnLan.parseMac(pc.mac) == null) {
            status.setTextColor(ERR)
            status.text = "Adresse MAC du PC inconnue : associez-le à nouveau en scannant le QR code."
            return
        }
        val id = ++wakeId
        waking = true
        status.setTextColor(DIM)
        power.isEnabled = false
        power.alpha = 0.5f
        cancel.visibility = View.VISIBLE
        io.execute {
            val started = System.currentTimeMillis()
            var attempt = 0
            val say: (String) -> Unit = { text -> ui.post { if (id == wakeId) status.text = text } }
            while (id == wakeId && System.currentTimeMillis() - started < WAKE_TIMEOUT_MS) {
                val elapsed = System.currentTimeMillis() - started
                // Le signal est renvoyé au début (un paquet UDP peut se perdre) puis deux fois plus tard.
                if (attempt < 5 || attempt == 30 || attempt == 60) WakeOnLan.send(this, pc.mac)
                say(
                    when {
                        elapsed < 10_000 -> "Signal d'allumage envoyé…"
                        elapsed < 90_000 -> "Démarrage de Windows… (${elapsed / 1000} s)"
                        else -> "Toujours en attente… Si Windows demande un mot de passe, ouvrez la session sur le PC."
                    },
                )
                val session = runCatching { PcClient(pc).session() }.getOrNull()
                if (session != null) {
                    onAwake(pc, session, id, say)
                    return@execute
                }
                attempt++
                Thread.sleep(2000)
            }
            ui.post {
                if (id == wakeId) {
                    waking = false
                    status.setTextColor(ERR)
                    status.text = "Le PC ne répond pas. Vérifiez le câble Ethernet, le Wake-on-LAN dans le BIOS et le démarrage rapide de Windows."
                    power.isEnabled = true
                    power.alpha = 1f
                    cancel.visibility = View.GONE
                }
            }
        }
    }

    /** Le PC répond : lance le mode choisi (le service peut mettre quelques secondes à être prêt), puis affiche l'interface. */
    private fun onAwake(pc: Pc, session: PcClient.Session, id: Int, say: (String) -> Unit) {
        val modeId = prefs.wakeMode
        if (session.authed && modeId.isNotEmpty()) {
            say("PC allumé — lancement du mode…")
            for (i in 0 until 5) {
                val response = runCatching { PcClient(pc).runMode(modeId) }.getOrNull()
                // 200 : lancé ; 409 : déjà en cours ; 404 : le mode n'existe plus.
                if (response != null && response.code in intArrayOf(200, 404, 409)) break
                Thread.sleep(2000)
            }
        }
        ui.post {
            if (id == wakeId) {
                waking = false
                route()
            }
        }
    }

    private fun cancelWake() {
        wakeId++
        waking = false
    }

    // ---------- association ----------

    private fun onScanned(text: String) {
        val uri = runCatching { Uri.parse(text) }.getOrNull()
        val host = uri?.host
        val fragment = uri?.fragment
        if (uri == null || uri.scheme != "http" || host == null || fragment == null || !isPrivateIPv4(host)) {
            toast("QR code non reconnu (il doit venir de Rituels PC, sur votre réseau local).")
            return
        }
        val details = Uri.parse("x://x?$fragment")
        val code = details.getQueryParameter("pair") ?: return toast("QR code non reconnu.")
        val pc = Pc(host, if (uri.port > 0) uri.port else 7799, details.getQueryParameter("name") ?: host, details.getQueryParameter("mac") ?: "")
        confirm("Associer « ${pc.name} » (${pc.host}) ?") { pair(pc, code) }
    }

    private fun manualPairing() {
        val address = EditText(this).apply {
            hint = "Adresse du PC (ex. 192.168.1.20)"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
        }
        val code = EditText(this).apply {
            hint = "Code d'association"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS
        }
        val form = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(8), dp(20), 0)
            addView(address)
            addView(code)
        }
        AlertDialog.Builder(this).setTitle("Association manuelle").setView(form)
            .setPositiveButton("Associer") { _, _ ->
                val parts = address.text.toString().trim().removePrefix("http://").split(":")
                val host = parts[0]
                val port = parts.getOrNull(1)?.toIntOrNull() ?: 7799
                if (!isPrivateIPv4(host)) toast("Adresse invalide : saisissez l'adresse locale du PC (ex. 192.168.1.20).")
                else pair(Pc(host, port, host, ""), code.text.toString())
            }
            .setNegativeButton("Annuler", null).show()
    }

    private fun pair(pc: Pc, code: String) {
        io.execute {
            val error = try {
                PcClient(pc).pair(code)
            } catch (e: Exception) {
                "PC injoignable : vérifiez qu'il est allumé, sur le même Wi-Fi, et que Rituels PC est autorisé dans le pare-feu."
            }
            ui.post {
                if (error == null) {
                    prefs.pc = pc
                    route()
                } else {
                    toast(error)
                }
            }
        }
    }

    private fun forget() {
        cancelWake()
        prefs.pc = null
        CookieManager.getInstance().removeAllCookies(null)
        CookieManager.getInstance().flush()
        route()
    }

    // ---------- outils d'interface ----------

    private fun enter(next: Screen) {
        webView?.let { (it.parent as? ViewGroup)?.removeView(it); it.destroy() }
        webView = null
        screen = next
    }

    private fun setScreen(view: View) {
        root.removeAllViews()
        root.addView(view, FrameLayout.LayoutParams(MATCH, MATCH))
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    private fun round(color: Int, radius: Int) = GradientDrawable().apply {
        setColor(color)
        cornerRadius = radius.toFloat()
    }

    private fun label(text: String, size: Float = 16f, color: Int = TEXT, bold: Boolean = false, center: Boolean = true) =
        TextView(this).apply {
            this.text = text
            textSize = size
            setTextColor(color)
            if (bold) setTypeface(typeface, Typeface.BOLD)
            if (center) gravity = Gravity.CENTER
        }

    private fun button(text: String, primary: Boolean = false, onClick: () -> Unit) = Button(this).apply {
        this.text = text
        isAllCaps = false
        textSize = 16f
        setTextColor(TEXT)
        background = round(if (primary) ACCENT else CARD2, dp(14))
        setPadding(dp(24), dp(12), dp(24), dp(12))
        setOnClickListener { onClick() }
    }

    private fun column(vararg views: View?) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER_HORIZONTAL
        setPadding(dp(24), dp(32), dp(24), dp(24))
        views.filterNotNull().forEach { view ->
            val params = (view.layoutParams as? LinearLayout.LayoutParams)
                ?: LinearLayout.LayoutParams(if (view is Button || view is ProgressBar) WRAP else MATCH, WRAP)
                    .apply { gravity = Gravity.CENTER_HORIZONTAL; topMargin = dp(14) }
            addView(view, params)
        }
    }

    private fun scroll(content: View) = ScrollView(this).apply { addView(content) }

    private fun confirm(message: String, onYes: () -> Unit) {
        AlertDialog.Builder(this).setMessage(message)
            .setPositiveButton("Oui") { _, _ -> onYes() }
            .setNegativeButton("Non", null).show()
    }

    private fun toast(message: String) = Toast.makeText(this, message, Toast.LENGTH_LONG).show()

    private companion object {
        const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
        const val WRAP = ViewGroup.LayoutParams.WRAP_CONTENT
        const val WAKE_TIMEOUT_MS = 5 * 60 * 1000L
        val BG = 0xFF0F1117.toInt()
        val CARD = 0xFF1A1D27.toInt()
        val CARD2 = 0xFF232736.toInt()
        val TEXT = 0xFFEEF0F7.toInt()
        val DIM = 0xFF8D93A8.toInt()
        val ACCENT = 0xFF7C6CFF.toInt()
        val ERR = 0xFFF87171.toInt()
    }
}
