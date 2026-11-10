package os.rovian.core.glass

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import os.rovian.core.poppinsTypography

/**
 * Rovian's Blue Liquid Glass design system, shared by Rovian Defender and PassGate.
 * Blue is the identity, glass the material: translucent layers with a bright top-left edge and a cyan return,
 * over deep navy (dark) or ice (light). Text sits on denser glass so it always stays readable.
 */
@Immutable
data class GlassColors(
    val dark: Boolean,
    val bgTop: Color, val bgMid: Color, val bgBottom: Color,
    val auraA: Color, val auraB: Color,
    val ink: Color, val muted: Color, val faint: Color,
    val glass: Color, val glassStrong: Color, val edgeHi: Color, val edgeLo: Color,
    val electric: Color, val sapphire: Color, val ice: Color, val cyan: Color,
    val good: Color, val warn: Color, val danger: Color,
    val onAccent: Color,
)

object Rovian {
    val Midnight = Color(0xFF040A22)
    val Navy = Color(0xFF071440)
    val Sapphire = Color(0xFF123A9C)
    val Electric = Color(0xFF2F6BFF)
    val Ice = Color(0xFFD9ECFF)
    val Cyan = Color(0xFF63E1FF)

    val DarkColors = GlassColors(
        dark = true,
        bgTop = Color(0xFF0B1E63), bgMid = Color(0xFF061036), bgBottom = Color(0xFF030820),
        auraA = Color(0x662F6BFF), auraB = Color(0x4463E1FF),
        ink = Color(0xFFF3F7FF), muted = Color(0xFFB3C1E6), faint = Color(0xFF7586B4),
        glass = Color(0x1AFFFFFF), glassStrong = Color(0x29FFFFFF), edgeHi = Color(0x73FFFFFF), edgeLo = Color(0x5963E1FF),
        electric = Electric, sapphire = Sapphire, ice = Ice, cyan = Cyan,
        good = Color(0xFF55E0B0), warn = Color(0xFFFFC266), danger = Color(0xFFFF6B88),
        onAccent = Color.White,
    )
    val LightColors = GlassColors(
        dark = false,
        bgTop = Color(0xFFD7E8FF), bgMid = Color(0xFFEAF3FF), bgBottom = Color(0xFFF6FAFF),
        auraA = Color(0x552F6BFF), auraB = Color(0x4463E1FF),
        ink = Color(0xFF071640), muted = Color(0xFF465985), faint = Color(0xFF7D8DB3),
        glass = Color(0x99FFFFFF), glassStrong = Color(0xCCFFFFFF), edgeHi = Color(0xFFFFFFFF), edgeLo = Color(0x662F6BFF),
        electric = Color(0xFF2357E8), sapphire = Sapphire, ice = Ice, cyan = Color(0xFF0FA6D8),
        good = Color(0xFF0E9F6E), warn = Color(0xFFC77700), danger = Color(0xFFD62D52),
        onAccent = Color.White,
    )
}

val LocalGlass = staticCompositionLocalOf { Rovian.DarkColors }

/** The theme: Blue Liquid Glass colours, Poppins type, Material underneath for controls. */
@Composable
fun GlassTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val c = if (dark) Rovian.DarkColors else Rovian.LightColors
    val scheme = if (dark) darkColorScheme(primary = c.electric, background = c.bgBottom, surface = c.bgMid, onSurface = c.ink, onBackground = c.ink, secondary = c.cyan)
        else lightColorScheme(primary = c.electric, background = c.bgBottom, surface = Color.White, onSurface = c.ink, onBackground = c.ink, secondary = c.cyan)
    CompositionLocalProvider(LocalGlass provides c) {
        MaterialTheme(colorScheme = scheme, typography = poppinsTypography(), content = content)
    }
}

/** Deep navy (or ice) with two slow light auras drifting behind the glass. Drawn, not blurred: cheap on the GPU. */
@Composable
fun GlassBackground(modifier: Modifier = Modifier, calm: Boolean = false, content: @Composable BoxScope.() -> Unit) {
    val c = LocalGlass.current
    val t = rememberInfiniteTransition(label = "aura")
    val drift by t.animateFloat(0f, 1f, infiniteRepeatable(tween(16_000, easing = LinearEasing), RepeatMode.Reverse), label = "drift")
    val d = if (calm) 0.5f else drift
    Box(modifier.fillMaxSize().drawBehind {
        drawRect(Brush.verticalGradient(listOf(c.bgTop, c.bgMid, c.bgBottom), endY = size.height))
        val a = Offset(size.width * (0.15f + 0.25f * d), size.height * (0.08f + 0.06f * d))
        drawCircle(Brush.radialGradient(listOf(c.auraA, Color.Transparent), center = a, radius = size.width * 0.9f), radius = size.width * 0.9f, center = a)
        val b = Offset(size.width * (0.95f - 0.3f * d), size.height * (0.32f + 0.1f * d))
        drawCircle(Brush.radialGradient(listOf(c.auraB, Color.Transparent), center = b, radius = size.width * 0.7f), radius = size.width * 0.7f, center = b)
    }, content = content)
}

/** The reflective edge: brightest at the top left, a cool cyan return at the bottom right. */
@Composable
fun glassEdge(): Brush {
    val c = LocalGlass.current
    return remember(c) { Brush.linearGradient(listOf(c.edgeHi, c.edgeHi.copy(alpha = c.edgeHi.alpha * 0.15f), c.edgeLo), start = Offset(0f, 0f), end = Offset(900f, 900f)) }
}

/** A glass surface. Press it and it gives a little, like a real material. */
@Composable
fun GlassCard(
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(24.dp),
    strong: Boolean = false,
    tint: Color? = null,
    onClick: (() -> Unit)? = null,
    padding: Dp = 16.dp,
    content: @Composable ColumnScope.() -> Unit,
) {
    val c = LocalGlass.current
    val src = remember { MutableInteractionSource() }
    val pressed by src.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.975f else 1f, spring(dampingRatio = 0.62f, stiffness = Spring.StiffnessMedium), label = "press")
    Column(
        modifier
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .clip(shape)
            .background(if (strong) c.glassStrong else c.glass)
            .let { m -> if (tint != null) m.background(Brush.linearGradient(listOf(tint.copy(alpha = 0.22f), tint.copy(alpha = 0.04f)))) else m }
            .background(Brush.verticalGradient(listOf(Color.White.copy(alpha = if (c.dark) 0.07f else 0.35f), Color.Transparent), endY = 160f))
            .border(1.dp, glassEdge(), shape)
            .let { m -> if (onClick != null) m.clickable(src, indication = null, onClick = onClick) else m }
            .padding(padding),
        content = content,
    )
}

/** The main action: electric blue glass with a highlight, springing on press. */
@Composable
fun GlassButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, icon: ImageVector? = null, enabled: Boolean = true, quiet: Boolean = false) {
    val c = LocalGlass.current
    val src = remember { MutableInteractionSource() }
    val pressed by src.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.96f else 1f, spring(dampingRatio = 0.55f, stiffness = Spring.StiffnessMedium), label = "btn")
    val shape = RoundedCornerShape(50)
    Row(
        modifier
            .graphicsLayer { scaleX = scale; scaleY = scale; alpha = if (enabled) 1f else 0.5f }
            .clip(shape)
            .background(if (quiet) Brush.linearGradient(listOf(c.glassStrong, c.glass)) else Brush.linearGradient(listOf(Color(0xFF5B8DFF), c.electric, Color(0xFF1D4AD6)), start = Offset(0f, 0f), end = Offset(400f, 200f)))
            .border(1.dp, if (quiet) glassEdge() else Brush.linearGradient(listOf(Color.White.copy(alpha = 0.7f), Color.White.copy(alpha = 0.1f))), shape)
            .clickable(src, indication = null, enabled = enabled, onClick = onClick)
            .padding(horizontal = 20.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) { Icon(icon, null, tint = if (quiet) c.ink else c.onAccent, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)) }
        Text(text, color = if (quiet) c.ink else c.onAccent, fontSize = 14.sp, fontWeight = FontWeight.Medium)
    }
}

/** A small status label: a coloured dot and words. */
@Composable
fun StatusPill(text: String, color: Color, modifier: Modifier = Modifier) {
    val c = LocalGlass.current
    Row(modifier.clip(RoundedCornerShape(50)).background(color.copy(alpha = if (c.dark) 0.16f else 0.12f)).padding(horizontal = 9.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(6.dp).clip(CircleShape).background(color))
        Spacer(Modifier.width(6.dp))
        Text(text, color = color, fontSize = 11.sp, fontWeight = FontWeight.Medium)
    }
}

data class NavItem(val icon: ImageVector, val label: String)

/** Floating glass navigation. The selected item sits in a glowing capsule that slides between items. */
@Composable
fun GlassNavBar(items: List<NavItem>, selected: Int, onSelect: (Int) -> Unit, modifier: Modifier = Modifier) {
    val c = LocalGlass.current
    val slot = 62.dp
    val pos by animateFloatAsState(selected.toFloat(), spring(dampingRatio = 0.72f, stiffness = Spring.StiffnessMediumLow), label = "nav")
    Box(modifier.clip(RoundedCornerShape(50)).background(if (c.dark) Color(0xCC0A1640) else Color(0xE6FFFFFF)).border(1.dp, glassEdge(), RoundedCornerShape(50)).padding(6.dp)) {
        Box(Modifier.graphicsLayer { translationX = pos * slot.toPx() }.size(slot, 50.dp).clip(RoundedCornerShape(50))
            .background(Brush.linearGradient(listOf(Color(0xFF5B8DFF), c.electric)))
            .drawBehind { drawCircle(Brush.radialGradient(listOf(Color.White.copy(alpha = 0.35f), Color.Transparent), center = Offset(size.width * 0.3f, 0f), radius = size.width)) })
        Row {
            items.forEachIndexed { i, item ->
                val on = i == selected
                Column(Modifier.size(slot, 50.dp).clip(RoundedCornerShape(50)).clickable { onSelect(i) }, horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = androidx.compose.foundation.layout.Arrangement.Center) {
                    Icon(item.icon, item.label, tint = if (on) Color.White else c.muted, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.height(2.dp))
                    Text(item.label, color = if (on) Color.White else c.muted, fontSize = 9.5.sp, fontWeight = if (on) FontWeight.Medium else FontWeight.Normal, maxLines = 1)
                }
            }
        }
    }
}

/** Section heading over glass. */
@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier, action: String? = null, onAction: (() -> Unit)? = null) {
    val c = LocalGlass.current
    Row(modifier.padding(top = 22.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(text, color = c.ink, fontSize = 17.sp, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
        if (action != null && onAction != null) Text(action, color = c.cyan, fontSize = 13.sp, modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable(onClick = onAction).padding(6.dp))
    }
}

/** Gentle breathing for glowing objects (0..1). */
@Composable
fun breathing(periodMs: Int = 3200): Float {
    val t = rememberInfiniteTransition(label = "breath")
    val v by t.animateFloat(0f, 1f, infiniteRepeatable(tween(periodMs, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "b")
    return v
}
