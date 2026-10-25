package com.paddlesnitch.app.paddles

import android.annotation.SuppressLint
import android.view.MotionEvent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import org.maplibre.android.MapLibre
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.maps.MapLibreMapOptions
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.expressions.Expression
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.Property
import org.maplibre.android.style.layers.PropertyFactory
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.LineString
import org.maplibre.geojson.Point
import com.paddlesnitch.app.ui.PsColor

// The website's map tiles (components/map/AnalysisMap.tsx): Esri's keyless
// dark grey canvas, native to z16 and upscaled beyond.
private const val TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
private val STYLE = """
    {"version":8,
     "sources":{"esri":{"type":"raster","tiles":["$TILES"],"tileSize":256,"maxzoom":16,"attribution":"Tiles © Esri"}},
     "layers":[{"id":"bg","type":"background","paint":{"background-color":"${hex(PsColor.bg)}"}},{"id":"esri","type":"raster","source":"esri"}]}
""".trimIndent()

private fun hex(rgb: Int) = "#%06x".format(rgb and 0xFFFFFF)
private fun hex(c: Color) = hex(c.toArgb())

/** The route on the dark map, coloured by speed, with green start and red finish dots. */
@SuppressLint("ClickableViewAccessibility")
@Composable
fun RouteMap(route: List<RouteRun>, bounds: Bounds, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val view = remember {
        MapLibre.getInstance(context)
        MapView(context, MapLibreMapOptions.createFromAttributes(context).textureMode(true).logoEnabled(false)
            .rotateGesturesEnabled(false).tiltGesturesEnabled(false).maxZoomPreference(19.0)).apply {
            onCreate(null)
            // Drags move the map, not the page around it.
            setOnTouchListener { v, e -> if (e.actionMasked == MotionEvent.ACTION_DOWN) v.parent?.requestDisallowInterceptTouchEvent(true); false }
            getMapAsync { map ->
                map.setStyle(Style.Builder().fromJson(STYLE)) { style ->
                    val lines = route.map { run ->
                        Feature.fromGeometry(LineString.fromLngLats(run.coords.map { Point.fromLngLat(it.lng, it.lat) })).apply { addStringProperty("c", hex(run.colour)) }
                    }
                    style.addSource(GeoJsonSource("route", FeatureCollection.fromFeatures(lines)))
                    style.addLayer(LineLayer("route", "route").withProperties(
                        PropertyFactory.lineColor(Expression.get("c")), PropertyFactory.lineWidth(4f),
                        PropertyFactory.lineCap(Property.LINE_CAP_ROUND), PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND),
                    ))
                    val first = route.first().coords.first(); val last = route.last().coords.last()
                    listOf("start" to (first to hex(PsColor.green)), "finish" to (last to hex(PsColor.red))).forEach { (id, p) ->
                        style.addSource(GeoJsonSource(id, Point.fromLngLat(p.first.lng, p.first.lat)))
                        style.addLayer(CircleLayer(id, id).withProperties(
                            PropertyFactory.circleRadius(6f), PropertyFactory.circleColor(p.second),
                            PropertyFactory.circleStrokeColor(hex(PsColor.bg)), PropertyFactory.circleStrokeWidth(2f),
                        ))
                    }
                    val pad = (minOf(width, height) * 0.08).toInt().coerceAtMost((70 * resources.displayMetrics.density).toInt())
                    map.moveCamera(CameraUpdateFactory.newLatLngBounds(
                        LatLngBounds.Builder().include(LatLng(bounds.south, bounds.west)).include(LatLng(bounds.north, bounds.east)).build(), pad))
                }
            }
        }
    }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, e ->
            when (e) {
                Lifecycle.Event.ON_START -> view.onStart()
                Lifecycle.Event.ON_RESUME -> view.onResume()
                Lifecycle.Event.ON_PAUSE -> view.onPause()
                Lifecycle.Event.ON_STOP -> view.onStop()
                else -> {}
            }
        }
        lifecycle.addObserver(observer)
        onDispose {
            lifecycle.removeObserver(observer)
            if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) view.onPause()
            if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) view.onStop()
            view.onDestroy()
        }
    }
    AndroidView({ view }, modifier.semantics { contentDescription = "Map of the route, coloured by speed from blue for slower to red for faster" })
}
