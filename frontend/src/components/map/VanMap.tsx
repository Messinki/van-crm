// The one map component (D-049): Leaflet on OSM tiles, van pins in one colour
// and home pins in another. The single-van dialog and the all-vans view both
// use it. No lines or radius circles — out of scope.
//
// Pins are plain divIcon circles rather than Leaflet's default marker images,
// which need their image paths fixed up under Vite.

import { useEffect, type ReactNode } from 'react'
import L from 'leaflet'
import { MapContainer, Marker, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import 'leaflet/dist/leaflet.css'
// Only the base cluster CSS (the zoom animations): the Default stylesheet
// colours bubbles green/yellow/orange by size, and vans are one colour.
import 'react-leaflet-cluster/dist/assets/MarkerCluster.css'

import type { Home } from '@/lib/schema'
import { cn } from '@/lib/utils'

export interface VanPoint {
  id: number
  lat: number
  lng: number
  /** Shown in the pin's hover tooltip. */
  label: string
}

// Van orange; home teal, matching HomePill. Homes are a touch bigger with a
// white centre so they read as different even without the colour.
const VAN_COLOUR = '#ea580c'
const HOME_COLOUR = '#0d9488'

function pin(size: number, colour: string, dot: boolean): L.DivIcon {
  const centre = dot
    ? `<span style="position:absolute;inset:${size / 2 - 3}px;border-radius:9999px;background:white"></span>`
    : ''
  return L.divIcon({
    // An empty className drops Leaflet's default white-box styling.
    className: '',
    html: `<span style="position:relative;display:block;width:${size}px;height:${size}px;border-radius:9999px;background:${colour};border:2px solid white;box-shadow:0 1px 3px rgb(0 0 0 / 0.45)">${centre}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

const VAN_PIN = pin(16, VAN_COLOUR, false)
const HOME_PIN = pin(20, HOME_COLOUR, true)

/** A cluster of vans: a bigger van-coloured circle with the count in it.
 *  Typed structurally — the markercluster type package isn't installed, and
 *  this is the only method used. */
function clusterIcon(cluster: { getChildCount(): number }): L.DivIcon {
  const count = cluster.getChildCount()
  const size = count < 10 ? 28 : count < 100 ? 34 : 40
  return L.divIcon({
    className: '',
    html: `<span style="display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:9999px;background:${VAN_COLOUR};border:2px solid white;box-shadow:0 1px 3px rgb(0 0 0 / 0.45);color:white;font:600 12px/1 system-ui,sans-serif">${count}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

// Roughly the middle of Great Britain, for a map with nothing on it.
const UK_CENTRE: L.LatLngTuple = [54.0, -2.5]
// Outcode-level accuracy (D-048): zooming further in than this on one pin
// would suggest a precision the coordinates don't have.
const MAX_FIT_ZOOM = 11

/** Fits every pin in view whenever the set of pins changes, and keeps Leaflet's
 *  idea of its size current when the box around it resizes. */
function FitToPoints({ points }: { points: L.LatLngTuple[] }) {
  const map = useMap()
  // Keyed on the coordinates themselves: `points` is a new array every render,
  // and the view should only jump when a pin actually moves.
  const key = JSON.stringify(points)

  useEffect(() => {
    const fit = JSON.parse(key) as L.LatLngTuple[]
    if (fit.length) map.fitBounds(fit, { padding: [40, 40], maxZoom: MAX_FIT_ZOOM })
    else map.setView(UK_CENTRE, 6)
  }, [map, key])

  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(map.getContainer())
    return () => observer.disconnect()
  }, [map])

  return null
}

interface Props {
  vans: VanPoint[]
  homes: Home[]
  className?: string
  /** Group nearby van pins into numbered bubbles. Home pins never cluster. */
  cluster?: boolean
  /** Content of the card that opens when a van pin is clicked. */
  renderCard?: (id: number) => ReactNode
}

export function VanMap({ vans, homes, className, cluster = false, renderCard }: Props) {
  const points: L.LatLngTuple[] = [...vans, ...homes].map((p) => [p.lat, p.lng])
  const vanPins = vans.map((van) => (
    <Marker key={'van-' + van.id} position={[van.lat, van.lng]} icon={VAN_PIN}>
      {/* With a card opening above the pin, the hover label goes below it. */}
      <Tooltip direction={renderCard ? 'bottom' : 'top'} offset={renderCard ? [0, 8] : [0, -8]}>
        {van.label}
      </Tooltip>
      {renderCard && (
        <Popup offset={[0, -4]} closeButton={false}>
          {renderCard(van.id)}
        </Popup>
      )}
    </Marker>
  ))
  return (
    // `isolate` keeps Leaflet's high z-index panes and controls from poking
    // through dialogs and menus layered over the map.
    <MapContainer center={UK_CENTRE} zoom={6} className={cn('isolate rounded-md', className)}>
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        maxZoom={19}
      />
      {homes.map((home) => (
        <Marker key={'home-' + home.id} position={[home.lat, home.lng]} icon={HOME_PIN}>
          <Tooltip direction="top" offset={[0, -10]}>
            {home.label}
          </Tooltip>
        </Marker>
      ))}
      {cluster ? (
        // No coverage polygon on hover: it reads as the kind of area shape
        // the maps deliberately leave out.
        <MarkerClusterGroup iconCreateFunction={clusterIcon} showCoverageOnHover={false}>
          {vanPins}
        </MarkerClusterGroup>
      ) : (
        vanPins
      )}
      <FitToPoints points={points} />
    </MapContainer>
  )
}
