import React, { useEffect, useRef, useState } from 'react';
import {
  AdvancedMarker,
  APIProvider,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useAdvancedMarkerRef,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { Navigation, MapPin } from 'lucide-react';
import { Pharmacy } from '../types';
import { useAuth } from '../context/AuthContext';

interface PharmacyMapProps {
  pharmacies: Pharmacy[];
  userLocation: { lat: number; lng: number } | null;
  selectedPharmacy: Pharmacy | null;
  onSelectPharmacy: (pharmacy: Pharmacy) => void;
  routeTarget: Pharmacy | null;
  onClearRoute?: () => void;
  pickMode?: boolean;
  pickedCoords?: { lat: number; lng: number } | null;
  onPickCoords?: (coords: { lat: number; lng: number }) => void;
}

const DEFAULT_ETHIOPIA_CENTER = { lat: 9.0192, lng: 38.7525 }; // Addis Ababa

const PharmacyMarker: React.FC<{
  pharmacy: Pharmacy;
  isSelected: boolean;
  onSelect: (p: Pharmacy) => void;
}> = ({ pharmacy, isSelected, onSelect }) => {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const [open, setOpen] = useState(false);

  if (typeof pharmacy.lat !== 'number' || typeof pharmacy.lng !== 'number') return null;

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={{ lat: pharmacy.lat, lng: pharmacy.lng }}
        onClick={() => {
          setOpen(true);
          onSelect(pharmacy);
        }}
        title={pharmacy.name}
      >
        <Pin
          background={isSelected ? '#43B02A' : '#123F91'}
          borderColor="#FFFFFF"
          glyphColor="#FFFFFF"
          scale={isSelected ? 1.2 : 1.0}
        />
      </AdvancedMarker>
      {open && marker && (
        <InfoWindow anchor={marker} onCloseClick={() => setOpen(false)} maxWidth={240}>
          <div className="p-1 text-slate-900">
            <div className="font-semibold text-sm">{pharmacy.name}</div>
            <div className="text-xs text-slate-600 mt-0.5">
              {[pharmacy.subCity, pharmacy.city, pharmacy.region].filter(Boolean).join(', ')}
            </div>
            {pharmacy.openingHours && (
              <div className="text-xs text-slate-500 mt-1">{pharmacy.openingHours}</div>
            )}
            <div className="text-xs font-mono text-[#123F91] mt-1 tabular-nums">{pharmacy.phone}</div>
          </div>
        </InfoWindow>
      )}
    </>
  );
};

interface MapsPolylineLike {
  setMap: (map: unknown) => void;
  setOptions: (opts: { strokeColor?: string; strokeWeight?: number }) => void;
}

const RouteOverlay: React.FC<{
  origin: { lat: number; lng: number } | null;
  destination: Pharmacy | null;
  onRouteInfo: (info: { distanceMeters: number; durationMillis: number } | null) => void;
  onError: (msg: string | null) => void;
}> = ({ origin, destination, onRouteInfo, onError }) => {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');
  const polylinesRef = useRef<MapsPolylineLike[]>([]);

  useEffect(() => {
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];
    onRouteInfo(null);
    onError(null);

    if (
      !routesLib ||
      !map ||
      !origin ||
      !destination ||
      typeof destination.lat !== 'number' ||
      typeof destination.lng !== 'number'
    ) {
      return;
    }

    let cancelled = false;
    const request = {
      origin: { lat: origin.lat, lng: origin.lng },
      destination: { lat: destination.lat, lng: destination.lng },
      travelMode: 'DRIVING',
      fields: ['path', 'distanceMeters', 'durationMillis', 'viewport'],
    };

    const RouteClass = (routesLib as unknown as {
      Route?: {
        computeRoutes: (req: unknown) => Promise<{
          routes: Array<{
            createPolylines: () => MapsPolylineLike[];
            viewport?: Parameters<typeof map.fitBounds>[0];
            distanceMeters?: number;
            durationMillis?: number;
          }>;
        }>;
      };
    }).Route;

    if (!RouteClass?.computeRoutes) {
      onError('Routes service unavailable.');
      return;
    }

    RouteClass.computeRoutes(request)
      .then(({ routes }) => {
        if (cancelled) return;
        if (!routes || routes.length === 0) {
          onError('No drivable route found between these coordinates.');
          return;
        }
        const primary = routes[0];
        const lines = primary.createPolylines();
        lines.forEach((line) => {
          line.setOptions({ strokeColor: '#123F91', strokeWeight: 5 });
          line.setMap(map);
        });
        polylinesRef.current = lines;
        if (primary.viewport) {
          map.fitBounds(primary.viewport);
        }
        onRouteInfo({
          distanceMeters: primary.distanceMeters ?? 0,
          durationMillis: primary.durationMillis ?? 0,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('OVER_QUERY_LIMIT') || msg.includes('429')) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
        onError('Unable to calculate route right now. Check GPS permissions or network.');
      });

    return () => {
      cancelled = true;
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
    };
  }, [routesLib, map, origin, destination, onRouteInfo, onError]);

  return null;
};

interface PharmacyMapPropsExtended extends PharmacyMapProps {
  heightClassName?: string;
}

export const PharmacyMap: React.FC<PharmacyMapPropsExtended> = ({
  pharmacies,
  userLocation,
  selectedPharmacy,
  onSelectPharmacy,
  routeTarget,
  onClearRoute,
  pickMode = false,
  pickedCoords,
  onPickCoords,
  heightClassName = 'h-[260px] sm:h-[340px] lg:h-[400px]',
}) => {
  const { language } = useAuth();
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  const [routeInfo, setRouteInfo] = useState<{ distanceMeters: number; durationMillis: number } | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);

  const center =
    pickedCoords ||
    (selectedPharmacy && typeof selectedPharmacy.lat === 'number' && typeof selectedPharmacy.lng === 'number'
      ? { lat: selectedPharmacy.lat, lng: selectedPharmacy.lng }
      : null) ||
    userLocation ||
    DEFAULT_ETHIOPIA_CENTER;

  if (!apiKey) {
    return (
      <div className={`w-full ${heightClassName} rounded-xl border border-slate-200 bg-slate-50 flex flex-col items-center justify-center p-6 text-center`}>
        <MapPin className="w-8 h-8 text-[#123F91] mb-2" />
        <p className="text-sm font-semibold text-slate-900">Google Maps API Key Required</p>
        <p className="text-xs text-slate-500 mt-1 max-w-sm">
          Configure VITE_GOOGLE_MAPS_API_KEY to enable interactive Ethiopian pharmacy mapping and turn-by-turn routes.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className={`w-full ${heightClassName} rounded-xl overflow-hidden border border-slate-200 relative`}>
        <APIProvider
          apiKey={apiKey}
          libraries={['marker', 'routes']}
          language={language === 'am' ? 'am' : 'en'}
          region="ET"
        >
          <GoogleMap
            defaultCenter={center}
            defaultZoom={12}
            mapId="DEMO_MAP_ID"
            gestureHandling="greedy"
            internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
            style={{ width: '100%', height: '100%' }}
            onClick={(e) => {
              if (pickMode && onPickCoords && e.detail.latLng) {
                onPickCoords({ lat: e.detail.latLng.lat, lng: e.detail.latLng.lng });
              }
            }}
          >
            {userLocation && (
              <AdvancedMarker position={userLocation} title="Your GPS Location">
                <div className="w-4 h-4 rounded-full bg-[#43B02A] border-2 border-white shadow-md" />
              </AdvancedMarker>
            )}

            {pickedCoords && pickMode && (
              <AdvancedMarker position={pickedCoords} title="Selected Pharmacy Coordinates">
                <Pin background="#43B02A" borderColor="#ffffff" glyphColor="#ffffff" />
              </AdvancedMarker>
            )}

            {pharmacies.map((p) => (
              <PharmacyMarker
                key={p.id}
                pharmacy={p}
                isSelected={selectedPharmacy?.id === p.id}
                onSelect={onSelectPharmacy}
              />
            ))}

            <RouteOverlay
              origin={userLocation}
              destination={routeTarget}
              onRouteInfo={setRouteInfo}
              onError={setRouteError}
            />
          </GoogleMap>
        </APIProvider>
      </div>

      {routeTarget && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-xs">
          <div className="flex flex-wrap items-center gap-2 text-slate-800">
            <Navigation className="w-4 h-4 text-[#123F91] shrink-0" />
            <span className="font-semibold">Directions to {routeTarget.name}</span>
            {routeInfo && (
              <span className="font-mono tabular-nums text-slate-600">
                · {(routeInfo.distanceMeters / 1000).toFixed(2)} km ·{' '}
                {Math.max(1, Math.round(routeInfo.durationMillis / 60000))} min drive
              </span>
            )}
            {!userLocation && (
              <span className="text-amber-700">Enable GPS to calculate route from your location.</span>
            )}
            {routeError && <span className="text-red-700">{routeError}</span>}
          </div>
          {onClearRoute && (
            <button
              type="button"
              onClick={onClearRoute}
              className="text-slate-600 hover:text-slate-900 font-semibold underline self-start sm:self-auto min-h-[36px] inline-flex items-center"
            >
              Clear route
            </button>
          )}
        </div>
      )}
    </div>
  );
};
