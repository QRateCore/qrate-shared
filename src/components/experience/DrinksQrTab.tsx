'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Download, QrCode, X, Wine } from 'lucide-react';
import type { ExperienceService, RestaurantTable } from '../../types/experience';
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

  useEffect(() => {
    fetchTables();
  }, [fetchTables]);

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
              onClick={handleDownloadZip}
              disabled={downloading}
              className="px-4 py-2 border border-gray-200 rounded-lg font-medium text-gray-600 hover:bg-gray-50 transition-colors text-sm flex items-center gap-2 disabled:opacity-50"
            >
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Download All
            </button>
          )}
          <button
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

      {/* Table list */}
      <div className="grid gap-2" style={{ gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(220px, 1fr))' }}>
        {activeTables.map(table => (
          <button
            key={table.id}
            onClick={() => setQrModalTable(table)}
            data-testid={`drinks-qr-table-${table.table_number}`}
            className="flex items-center justify-between px-4 py-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-left"
          >
            <span className="font-medium text-gray-900 text-sm">
              {table.table_label || `Table ${table.table_number}`}
            </span>
            {table.drinks_qr_code_url ? (
              <QrCode className="h-4 w-4 text-orange-500" />
            ) : (
              <span className="text-xs text-gray-400">No QR yet</span>
            )}
          </button>
        ))}
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
