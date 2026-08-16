'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Download, QrCode, X, Wine } from 'lucide-react';
import type { ExperienceService, RestaurantTable, StaffMember } from '../../types/experience';
import { useIsMobile } from '../../hooks/useIsMobile';

interface DrinksQrTabProps {
  restaurantId?: string;
  service: ExperienceService;
}

/**
 * Drinks QR tab — generates a SEPARATE, standalone QR per table that routes
 * diners to the drinks-ordering app (qrate-drinks-webapp), independent of
 * the patron food-menu QR the Tables tab manages. Only rendered when the
 * admin-only `drinks_qr_enabled` deluxe flag is on for the restaurant — see
 * ExperienceManagement's `showDrinksTab` prop.
 *
 * Deliberately does not manage table creation/deletion/capacity — that stays
 * the Tables tab's job. This tab is scoped to exactly one thing: generate,
 * regenerate, view, and download the drinks QR codes for the tables that
 * already exist.
 */
export default function DrinksQrTab({ restaurantId, service }: DrinksQrTabProps) {
  const isMobile = useIsMobile();
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [qrModalTable, setQrModalTable] = useState<RestaurantTable | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showFeedback = useCallback((type: 'success' | 'error', message: string) => {
    setFeedback({ type, message });
    setTimeout(() => setFeedback(null), 4000);
  }, []);

  const fetchTables = useCallback(async () => {
    if (!restaurantId) return;
    try {
      const data = await service.getTables(restaurantId);
      setTables(data.tables);
    } catch {
      showFeedback('error', 'Failed to load tables');
    } finally {
      setLoading(false);
    }
  }, [restaurantId, service, showFeedback]);

  const fetchStaff = useCallback(async () => {
    if (!restaurantId) return;
    try {
      const data = await service.getStaff(restaurantId);
      setStaff(data.staff);
    } catch {
      // Server names are a nice-to-have on the card — silently degrade to no name.
    }
  }, [restaurantId, service]);

  useEffect(() => {
    fetchTables();
    fetchStaff();
  }, [fetchTables, fetchStaff]);

  const handleGenerate = async () => {
    if (!restaurantId || !service.generateDrinksQRCodes) return;
    setGenerating(true);
    try {
      await service.generateDrinksQRCodes(restaurantId);
      await fetchTables();
      showFeedback('success', 'Drinks QR codes generated');
    } catch (err: any) {
      showFeedback('error', err?.response?.data?.error || 'Failed to generate drinks QR codes');
    } finally {
      setGenerating(false);
    }
  };

  const handleDownloadZip = async () => {
    if (!restaurantId || !service.downloadDrinksQRCodesZip) return;
    setDownloading(true);
    try {
      const { download_url } = await service.downloadDrinksQRCodesZip(restaurantId);
      window.open(download_url, '_blank');
    } catch (err: any) {
      showFeedback('error', err?.response?.data?.error || 'Failed to download drinks QR codes');
    } finally {
      setDownloading(false);
    }
  };

  const activeTables = tables.filter(t => t.is_active);
  const tablesWithDrinksQR = tables.filter(t => t.drinks_qr_code_url);

  if (!restaurantId) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p>No restaurant selected.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="text-center py-12">
        <Loader2 className="h-6 w-6 animate-spin mx-auto text-orange-500 mb-3" />
        <p className="text-sm text-gray-500">Loading tables...</p>
      </div>
    );
  }

  if (activeTables.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <Wine className="h-8 w-8 mx-auto mb-3 opacity-40" />
        <p className="font-medium">No tables found</p>
        <p className="text-sm mt-1">Add tables in the Tables tab first, then come back here to generate drinks QR codes.</p>
      </div>
    );
  }

  return (
    <div>
      {feedback && (
        <div className={`mb-4 px-4 py-2 rounded-lg text-sm font-medium ${feedback.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {feedback.message}
        </div>
      )}

      {/* Header */}
      <div className={isMobile ? 'flex flex-col gap-3 mb-4' : 'flex items-center justify-between mb-6'}>
        <div>
          {!isMobile && <h3 className="text-lg font-bold text-gray-900">Drinks QR</h3>}
          <p className="text-sm text-gray-500">
            {activeTables.length} active table{activeTables.length !== 1 ? 's' : ''}
            {' '}&middot;{' '}
            {tablesWithDrinksQR.length} with drinks QR codes
          </p>
          <p className="text-xs text-gray-400 mt-1">
            A separate, standalone QR for the drinks-ordering app — the food menu QR in the Tables tab is untouched.
          </p>
        </div>
        <div className={`flex gap-2 ${isMobile ? 'flex-wrap [&>button]:min-h-[44px]' : ''}`}>
          {tablesWithDrinksQR.length > 0 && (
            <button
              data-testid="download-drinks-qr-btn"
              onClick={handleDownloadZip}
              disabled={downloading}
              className="px-4 py-2 border border-gray-200 rounded-lg font-medium text-gray-600 hover:bg-gray-50 transition-colors text-sm flex items-center gap-2 disabled:opacity-50"
            >
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Download All
            </button>
          )}
          <button
            data-testid="generate-drinks-qr-btn"
            onClick={handleGenerate}
            disabled={generating || activeTables.length === 0}
            className="px-4 py-2 border border-gray-200 rounded-lg font-medium text-gray-600 hover:bg-gray-50 transition-colors text-sm flex items-center gap-2 disabled:opacity-50"
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <QrCode className="h-4 w-4" />
                {tablesWithDrinksQR.length > 0 ? 'Regenerate Drinks QR' : 'Generate Drinks QR'}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Table grid — same card shell as the Tables tab (border-dashed card,
          table name + server + QR icon row, status badge row) so the two QR
          surfaces read as one family in the owner UI. */}
      <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 ${isMobile ? 'pb-24' : ''}`}>
        {activeTables.map(table => {
          const hasQR = Boolean(table.drinks_qr_code_url);
          const serverName = table.assigned_server_id
            ? (staff.find(s => s.id === table.assigned_server_id)?.name ?? null)
            : null;
          const borderClass = hasQR ? 'border-orange-300' : 'border-gray-200';

          return (
            <div
              key={table.id}
              data-testid={`drinks-qr-table-${table.table_number}`}
              className={`border-2 border-dashed rounded-xl p-3 bg-white ${borderClass}`}
            >
              {/* Row 1: Table name + server + QR */}
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <h3 className="font-bold text-base text-gray-900 whitespace-nowrap">
                      {table.table_label || `Table ${table.table_number}`}
                    </h3>
                    {serverName && (
                      <span title={`Server: ${serverName}`} className="text-xs text-gray-400 truncate">Server: {serverName}</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setQrModalTable(table)}
                  className={`rounded-md hover:bg-gray-100 transition-colors flex-shrink-0 ${isMobile ? 'min-h-[44px] min-w-[44px] flex items-center justify-center' : 'p-1.5'}`}
                  title="Show drinks QR code"
                >
                  <QrCode className={`h-4 w-4 ${hasQR ? 'text-orange-500' : 'text-gray-400'}`} />
                </button>
              </div>

              {/* Row 2: Status badge */}
              <div className="mt-2">
                {hasQR ? (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-orange-100 text-orange-700">QR GENERATED</span>
                ) : (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-gray-100 text-gray-500">NOT GENERATED</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* QR Code Modal */}
      {qrModalTable && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onClick={() => setQrModalTable(null)}
        >
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative bg-white rounded-2xl shadow-2xl p-6 mx-4 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <button onClick={() => setQrModalTable(null)} className="absolute top-3 right-3 p-1.5 text-gray-400 hover:text-gray-600 rounded-lg">
              <X className="h-5 w-5" />
            </button>
            <h3 className="text-lg font-bold text-gray-900 text-center mb-1">
              {qrModalTable.table_label || `Table ${qrModalTable.table_number}`} &middot; Drinks
            </h3>
            <div className="flex items-center justify-center bg-gray-50 rounded-xl p-4 aspect-square">
              {qrModalTable.drinks_qr_code_url ? (
                <img src={qrModalTable.drinks_qr_code_url} alt={`Drinks QR code for Table ${qrModalTable.table_number}`} className="w-full h-full object-contain" />
              ) : (
                <div className="text-center text-gray-400">
                  <QrCode className="w-16 h-16 mx-auto mb-2" />
                  <p className="text-sm">Drinks QR code not generated</p>
                  <p className="text-xs mt-1">Use Generate Drinks QR above</p>
                </div>
              )}
            </div>
            <p className="text-xs text-gray-400 text-center mt-3">Scan to open the standalone drinks menu for this table</p>
          </div>
        </div>
      )}
    </div>
  );
}
