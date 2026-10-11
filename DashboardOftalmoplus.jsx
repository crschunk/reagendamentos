import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Filter,
  Loader2,
  RefreshCcw,
  Sparkles,
  SlidersHorizontal,
  Search,
  Stethoscope,
  TrendingUp,
  Users,
} from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

const SHEETS_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTN6qsShj7hYdbp5vo1TcAMPdK0QsxEv0diDeR2HqNtZef5blR5BHcRi-Wr9sl-UdxrOkHd8K459KBq/pub?gid=2026070203&single=true&output=csv";

const POLLING_INTERVAL_MS = 300000;

const STATUS_CONFIG = {
  Reagendado: {
    label: "Reagendados",
    color: "#10B981",
    border: "border-l-emerald-500",
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  },
  "Em Andamento": {
    label: "Em Andamento",
    color: "#F59E0B",
    border: "border-l-amber-500",
    badge: "bg-amber-50 text-amber-700 ring-amber-100",
  },
  "Para Reagendar": {
    label: "Para Reagendar",
    color: "#EF4444",
    border: "border-l-red-500",
    badge: "bg-red-50 text-red-700 ring-red-100",
  },
  "Não quer": {
    label: "Não quer",
    color: "#8B5CF6",
    border: "border-l-violet-500",
    badge: "bg-violet-50 text-violet-700 ring-violet-100",
  },
  "Sem Contato": {
    label: "Sem Contato",
    color: "#06B6D4",
    border: "border-l-cyan-500",
    badge: "bg-cyan-50 text-cyan-700 ring-cyan-100",
  },
};

const UNKNOWN_STATUS_CONFIG = {
  label: "Outro",
  color: "#64748B",
  border: "border-l-slate-400",
  badge: "bg-slate-50 text-slate-700 ring-slate-100",
};

const UNITS = ["Todas as Unidades", "Vitória", "Vila Velha", "Cariacica", "Serra"];

const STATUS_FILTERS = [
  { value: "Todos", label: "Todos", color: "#0A2540" },
  { value: "Reagendado", label: "Reagendado", color: "#10B981" },
  { value: "Em Andamento", label: "Em Andamento", color: "#F59E0B" },
  { value: "Para Reagendar", label: "Para Reagendar", color: "#EF4444" },
  { value: "Não quer", label: "Não quer", color: "#8B5CF6" },
  { value: "Sem Contato", label: "Sem Contato", color: "#06B6D4" },
];

function normalizeText(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeHeader(value) {
  return normalizeText(value).replace(/[^a-z0-9]/g, "");
}

function parseCsv(csv) {
  const rows = [];
  let row = [];
  let field = "";
  let insideQuotes = false;

  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];
    const nextChar = csv[i + 1];

    if (char === '"' && insideQuotes && nextChar === '"') {
      field += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      insideQuotes = !insideQuotes;
      continue;
    }

    if (char === "," && !insideQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !insideQuotes) {
      if (char === "\r" && nextChar === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((currentRow) => currentRow.some((cell) => cell.trim() !== ""));
}

function formatDateForInput(value) {
  const trimmedValue = String(value || "").trim();
  const isoMatch = trimmedValue.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const brMatch = trimmedValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);

  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  if (brMatch) {
    const [, day, month, year] = brMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const parsedDate = new Date(trimmedValue);
  if (!Number.isNaN(parsedDate.getTime())) {
    return parsedDate.toISOString().slice(0, 10);
  }

  return "";
}

function pickValue(record, aliases) {
  for (const alias of aliases) {
    const value = record[alias];
    if (value !== undefined && String(value).trim() !== "") return String(value).trim();
  }

  return "";
}

function normalizeStatus(value) {
  const normalized = normalizeText(value);

  // The sheet now uses operational statuses from the scheduling system.
  if (normalized === "finalizado" || normalized.includes("finalizad")) return "Reagendado";
  if (normalized === "faltante" || normalized.includes("falt")) return "Para Reagendar";
  if (normalized === "reagendado" || normalized.includes("reagendado")) return "Reagendado";
  if (normalized === "emandamento" || normalized.includes("andamento")) return "Em Andamento";
  if (normalized === "reagendar" || normalized === "parareagendar" || normalized.includes("reagendar")) return "Para Reagendar";
  if (normalized.includes("nao quer")) return "Não quer";
  if (normalized.includes("sem contato")) return "Sem Contato";

  return "Outro";
}

function transformRows(rows) {
  if (!rows.length) return [];

  const [headers, ...dataRows] = rows;
  const normalizedHeaders = headers.map(normalizeHeader);

  return dataRows.map((dataRow, index) => {
    const rawRecord = normalizedHeaders.reduce((accumulator, header, headerIndex) => {
      accumulator[header] = dataRow[headerIndex] || "";
      return accumulator;
    }, {});

    const date = pickValue(rawRecord, ["data", "datadoagendamento", "datadafalta", "datafalta", "faltouem"]);
    const unit = pickValue(rawRecord, ["unidade", "clinica", "local"]);
    // In the current export, the patient name is placed under "Profissional"
    // and the "Paciente" column is empty. Keep both layouts supported.
    const patient = pickValue(rawRecord, ["paciente", "nome", "nomedopaciente", "cliente", "profissional"]);
    const phone = pickValue(rawRecord, ["telefone", "celular", "contato", "whatsapp"]);
    const paymentMethod = pickValue(rawRecord, ["formadepagamento", "pagamento", "convenio"]);
    const rawStatus = pickValue(rawRecord, ["status", "situacao", "reagendamento"]);
    const status = normalizeStatus(rawStatus);

    return {
      id: `${patient}-${phone}-${date}-${index}`,
      date,
      dateInput: formatDateForInput(date),
      unit,
      patient,
      phone,
      paymentMethod,
      status,
      statusLabel: rawStatus || status,
    };
  });
}

function KpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
  borderClass,
  accentClass = "text-[#0A2540]",
  progress,
  progressColor = "bg-[#00A896]",
}) {
  return (
    <div className={`relative overflow-hidden rounded-3xl border border-slate-100 border-l-4 bg-white p-5 shadow-sm transition duration-300 hover:-translate-y-0.5 hover:shadow-soft ${borderClass}`}>
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-transparent via-slate-100 to-transparent" />
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">{title}</p>
          <strong className="mt-3 block text-3xl font-black tracking-tight text-[#0A2540]">{value}</strong>
          <span className="mt-1 block text-sm text-slate-500">{subtitle}</span>
        </div>
        <div className={`rounded-2xl p-3 ring-1 ring-slate-100 ${accentClass} bg-gradient-to-br from-slate-50 to-white`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      {typeof progress === "number" && (
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
            <span>Participação</span>
            <span>{progress.toFixed(0)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full ${progressColor}`} style={{ width: `${Math.min(progress, 100)}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status, label }) {
  const config = STATUS_CONFIG[status] || UNKNOWN_STATUS_CONFIG;

  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1 ${config.badge}`}>
      {label || status}
    </span>
  );
}

function PanelHeader({ eyebrow, title, description, badge }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <p className="mb-2 inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
          {eyebrow}
        </p>
        <h2 className="text-lg font-bold tracking-tight text-[#0A2540]">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
      {badge && (
        <div className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-semibold text-[#00A896] ring-1 ring-cyan-100">
          {badge}
        </div>
      )}
    </div>
  );
}

function FilterChip({ label, count, color, active, onClick, compact = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition duration-200 ${
        active
          ? "border-[#0A2540] bg-[#0A2540] text-white shadow-sm shadow-[#0A2540]/15"
          : "border-slate-200 bg-white text-slate-600 hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50"
      } ${compact ? "whitespace-nowrap" : ""}`}
      aria-pressed={active}
    >
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
      {typeof count === "number" && (
        <span className={`rounded-full px-2 py-0.5 text-xs ${active ? "bg-white/15 text-white" : "bg-slate-100 text-slate-500"}`}>
          {count}
        </span>
      )}
    </button>
  );
}

export default function DashboardOftalmoplus() {
  const [records, setRecords] = useState([]);
  const [selectedUnit, setSelectedUnit] = useState("Todas as Unidades");
  const [selectedPayment, setSelectedPayment] = useState("Todas as Formas");
  const [selectedDateStart, setSelectedDateStart] = useState("");
  const [selectedDateEnd, setSelectedDateEnd] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("Todos");
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showToast, setShowToast] = useState(false);

  async function fetchSheetData({ silent = false } = {}) {
    if (!silent) setLoading(true);
    setError("");

    try {
      const separator = SHEETS_CSV_URL.includes("?") ? "&" : "?";
      const response = await fetch(`${SHEETS_CSV_URL}${separator}t=${Date.now()}`);

      if (!response.ok) {
        throw new Error(`Falha ao buscar dados: HTTP ${response.status}`);
      }

      const csv = await response.text();
      const parsedRecords = transformRows(parseCsv(csv));

      setRecords(parsedRecords);
      setLastUpdatedAt(new Date());
      setShowToast(true);
      window.setTimeout(() => setShowToast(false), 3000);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Não foi possível atualizar os dados.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchSheetData();
    const intervalId = window.setInterval(() => fetchSheetData({ silent: true }), POLLING_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, []);

  const filteredBaseRecords = useMemo(() => {
    const normalizedSearch = normalizeText(searchTerm);
    const startDate = selectedDateStart || "";
    const endDate = selectedDateEnd || "";
    const effectiveStartDate = startDate && endDate && startDate > endDate ? endDate : startDate;
    const effectiveEndDate = startDate && endDate && startDate > endDate ? startDate : endDate;

    return records.filter((record) => {
      const matchesUnit = selectedUnit === "Todas as Unidades" || normalizeText(record.unit) === normalizeText(selectedUnit);
      const matchesPayment = selectedPayment === "Todas as Formas" || record.paymentMethod === selectedPayment;
      const matchesStartDate = !effectiveStartDate || (record.dateInput && record.dateInput >= effectiveStartDate);
      const matchesEndDate = !effectiveEndDate || (record.dateInput && record.dateInput <= effectiveEndDate);
      const matchesSearch =
        !normalizedSearch ||
        normalizeText(record.patient).includes(normalizedSearch) ||
        normalizeText(record.phone).includes(normalizedSearch) ||
        normalizeText(record.paymentMethod).includes(normalizedSearch);

      return matchesUnit && matchesPayment && matchesStartDate && matchesEndDate && matchesSearch;
    });
  }, [records, searchTerm, selectedDateEnd, selectedDateStart, selectedPayment, selectedUnit]);

  const filteredRecords = useMemo(() => {
    if (selectedStatus === "Todos") return filteredBaseRecords;

    return filteredBaseRecords.filter((record) => record.status === selectedStatus);
  }, [filteredBaseRecords, selectedStatus]);

  const statusCounts = useMemo(() => {
    return filteredBaseRecords.reduce(
      (counts, record) => {
        counts[record.status] = (counts[record.status] || 0) + 1;
        return counts;
      },
      { Reagendado: 0, "Em Andamento": 0, "Para Reagendar": 0, "Não quer": 0, "Sem Contato": 0, Outro: 0 }
    );
  }, [filteredBaseRecords]);

  const unitCounts = useMemo(
    () =>
      records.reduce((counts, record) => {
        const key = record.unit || "Sem unidade";
        counts[key] = (counts[key] || 0) + 1;
        return counts;
      }, {}),
    [records]
  );

  const paymentCounts = useMemo(
    () =>
      records.reduce((counts, record) => {
        const key = record.paymentMethod || "Sem pagamento";
        counts[key] = (counts[key] || 0) + 1;
        return counts;
      }, {}),
    [records]
  );

  const paymentOptions = useMemo(() => {
    const uniquePayments = Array.from(new Set(records.map((record) => record.paymentMethod).filter(Boolean)));

    return ["Todas as Formas", ...uniquePayments.sort((a, b) => a.localeCompare(b, "pt-BR"))];
  }, [records]);

  const metrics = useMemo(() => {
    const total = filteredRecords.length;
    const rescheduled = filteredRecords.filter((record) => record.status === "Reagendado").length;
    const inProgress = filteredRecords.filter((record) => record.status === "Em Andamento").length;
    const toReschedule = filteredRecords.filter((record) => record.status === "Para Reagendar").length;
    const conversionRate = total > 0 ? (rescheduled / total) * 100 : 0;

    return { total, rescheduled, inProgress, toReschedule, conversionRate };
  }, [filteredRecords]);

  const statusShares = useMemo(() => {
    const total = filteredRecords.length || 1;
    return {
      Reagendado: (metrics.rescheduled / total) * 100,
      "Em Andamento": (metrics.inProgress / total) * 100,
      "Para Reagendar": (metrics.toReschedule / total) * 100,
    };
  }, [filteredRecords.length, metrics.inProgress, metrics.rescheduled, metrics.toReschedule]);

  const chartData = Object.entries(STATUS_CONFIG)
    .map(([status, config]) => ({
      name: config.label,
      value: filteredRecords.filter((record) => record.status === status).length,
      color: config.color,
    }))
    .filter((item) => item.value > 0);

  const formattedLastUpdate = lastUpdatedAt
    ? lastUpdatedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "Aguardando atualização";

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#F8FAFC] px-4 py-6 text-slate-700 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute -left-24 top-12 h-72 w-72 rounded-full bg-cyan-100/40 blur-3xl" />
      <div className="pointer-events-none absolute right-0 top-28 h-96 w-96 rounded-full bg-[#0A2540]/5 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-emerald-100/40 blur-3xl" />
      {showToast && (
        <div className="fixed right-4 top-4 z-50 flex items-center gap-3 rounded-2xl border border-emerald-100 bg-white/95 px-4 py-3 text-sm font-medium text-emerald-700 shadow-lg backdrop-blur">
          <Sparkles className="h-4 w-4" />
          Dados atualizados com sucesso.
        </div>
      )}

      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="overflow-hidden rounded-[2rem] border border-white/50 bg-[#0A2540] p-6 text-white shadow-soft ring-1 ring-white/10 md:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-sm text-cyan-50 backdrop-blur">
                <Stethoscope className="h-4 w-4 text-[#00A896]" />
                Gestão de faltas e recuperação de agenda
              </div>
              <h1 className="max-w-3xl text-3xl font-black tracking-tight md:text-5xl">
                Oftalmoplus — Absenteísmo & Reagendamento
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-cyan-50/80 md:text-base">
                Monitoramento em tempo real da operação, com leitura executiva de desempenho, filtros instantâneos e visão clara da conversão da equipe.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[360px] lg:grid-cols-1">
              <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm backdrop-blur">
                <span className="flex items-center gap-2 text-cyan-50/90">
                  <Clock3 className="h-4 w-4 text-[#00A896]" />
                  {lastUpdatedAt ? `Atualizado às ${formattedLastUpdate}` : formattedLastUpdate}
                </span>
                <div className="mt-2 flex items-center gap-2 text-xs text-cyan-50/60">
                  <div className="h-2 w-2 rounded-full bg-emerald-400" />
                  Conexão ativa com Google Sheets
                </div>
              </div>
              <button
                type="button"
                onClick={() => fetchSheetData()}
                disabled={loading}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#00A896] to-cyan-500 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:scale-[1.01] hover:from-[#029987] hover:to-cyan-400 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                Atualizar Agora
              </button>
            </div>
          </div>
        </header>

        {error && (
          <div className="flex items-center gap-3 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertCircle className="h-5 w-5" />
            {error}
          </div>
        )}

        <section className="rounded-[1.75rem] border border-white/70 bg-white/90 p-4 shadow-soft backdrop-blur-sm">
          <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-[#0A2540] p-3 text-white shadow-sm">
                <Filter className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-bold text-[#0A2540]">Filtros operacionais</p>
                <p className="text-xs text-slate-500">Refine a visão em segundos</p>
              </div>
            </div>
            <div className="hidden items-center gap-2 rounded-full bg-slate-50 px-3 py-2 text-xs text-slate-500 md:flex">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Interface otimizada para análise executiva
            </div>
          </div>

          <div className="space-y-5">
            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-[#0A2540]">Unidade</span>
                <span className="text-xs text-slate-400">Seleção com 1 clique</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {UNITS.map((unit) => (
                  <FilterChip
                    key={unit}
                    label={unit}
                    count={unitCounts[unit] || 0}
                    color={unit === selectedUnit ? "#ffffff" : "#00A896"}
                    active={selectedUnit === unit}
                    onClick={() => setSelectedUnit(unit)}
                    compact
                  />
                ))}
              </div>
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-[#0A2540]">Forma de Pagamento</span>
                <span className="text-xs text-slate-400">Convênios listados individualmente</span>
              </div>
              <div className="max-w-md">
                <select
                  value={selectedPayment}
                  onChange={(event) => setSelectedPayment(event.target.value)}
                  className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none transition focus:border-[#00A896] focus:ring-4 focus:ring-cyan-50"
                >
                  {paymentOptions.map((payment) => (
                    <option key={payment} value={payment}>
                      {payment} {payment === "Todas as Formas" ? `(${records.length})` : `(${paymentCounts[payment] || 0})`}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1.2fr_auto]">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-[#0A2540]">Período inicial</span>
                <div className="relative">
                  <CalendarDays className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="date"
                    value={selectedDateStart}
                    onChange={(event) => setSelectedDateStart(event.target.value)}
                    className="h-12 w-full rounded-2xl border border-slate-200 bg-white pl-11 pr-4 text-sm outline-none transition focus:border-[#00A896] focus:ring-4 focus:ring-cyan-50"
                  />
                </div>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-[#0A2540]">Período final</span>
                <div className="relative">
                  <CalendarDays className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="date"
                    value={selectedDateEnd}
                    onChange={(event) => setSelectedDateEnd(event.target.value)}
                    className="h-12 w-full rounded-2xl border border-slate-200 bg-white pl-11 pr-4 text-sm outline-none transition focus:border-[#00A896] focus:ring-4 focus:ring-cyan-50"
                  />
                </div>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-[#0A2540]">Busca Rápida</span>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="search"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Filtrar por paciente, telefone ou pagamento"
                    className="h-12 w-full rounded-2xl border border-slate-200 bg-white pl-11 pr-4 text-sm outline-none transition focus:border-[#00A896] focus:ring-4 focus:ring-cyan-50"
                  />
                </div>
              </label>

              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedDateStart("");
                    setSelectedDateEnd("");
                  }}
                  className="h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                >
                  Limpar
                </button>
              </div>
            </div>
          </div>

          <div className="mt-4 border-t border-slate-100 pt-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-[#0A2540]">Status</span>
              <span className="text-xs text-slate-400">Filtro aplicado na tabela, KPIs e gráficos</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {STATUS_FILTERS.map((status) => {
                const isActive = selectedStatus === status.value;
                const count =
                  status.value === "Todos"
                    ? filteredBaseRecords.length
                    : statusCounts[status.value] || 0;

                return (
                  <FilterChip
                    key={status.value}
                    label={status.label}
                    count={count}
                    color={status.color}
                    active={isActive}
                    onClick={() => setSelectedStatus(status.value)}
                  />
                );
              })}
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <KpiCard title="Total de Faltosos" value={metrics.total} subtitle="Registros filtrados" icon={Users} borderClass="border-l-[#0A2540]" progress={100} progressColor="bg-[#0A2540]" />
          <KpiCard title="Reagendados" value={metrics.rescheduled} subtitle="Pacientes recuperados" icon={CheckCircle2} borderClass="border-l-emerald-500" accentClass="text-emerald-600" progress={statusShares.Reagendado} progressColor="bg-emerald-500" />
          <KpiCard title="Em Andamento" value={metrics.inProgress} subtitle="Contatos em tratativa" icon={Activity} borderClass="border-l-amber-500" accentClass="text-amber-600" progress={statusShares["Em Andamento"]} progressColor="bg-amber-500" />
          <KpiCard title="Para Reagendar" value={metrics.toReschedule} subtitle="Pendências ativas" icon={AlertCircle} borderClass="border-l-red-500" accentClass="text-red-600" progress={statusShares["Para Reagendar"]} progressColor="bg-red-500" />
          <KpiCard title="Taxa de Conversão" value={`${metrics.conversionRate.toFixed(1)}%`} subtitle="Reagendados / faltosos" icon={TrendingUp} borderClass="border-l-[#00A896]" accentClass="text-[#00A896]" progress={metrics.conversionRate} progressColor="bg-gradient-to-r from-[#00A896] to-cyan-500" />
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-[1.75rem] border border-slate-100 bg-white/95 p-5 shadow-soft backdrop-blur-sm">
            <PanelHeader
              eyebrow="Análise"
              title="Distribuição por Status"
              description="Proporção atual dos pacientes faltosos."
              badge="Tempo real"
            />
            <div className="h-72">
              {chartData.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={chartData} dataKey="value" nameKey="name" innerRadius={72} outerRadius={104} paddingAngle={4}>
                      {chartData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      cursor={{ fill: "rgba(10,37,64,0.04)" }}
                      contentStyle={{ borderRadius: 16, border: "1px solid #e2e8f0", boxShadow: "0 14px 35px rgba(15, 23, 42, 0.12)" }}
                      formatter={(value, name) => [value, name]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center rounded-2xl bg-slate-50 text-sm text-slate-400">
                  Sem dados para exibir no período selecionado.
                </div>
              )}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {Object.entries(STATUS_CONFIG).map(([status, config]) => (
                <div key={status} className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3 text-sm text-slate-600">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: config.color }} />
                    <span className="font-semibold text-slate-700">{config.label}</span>
                  </div>
                  <div className="text-2xl font-black text-[#0A2540]">{statusCounts[status] || 0}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[1.75rem] border border-slate-100 bg-white/95 p-5 shadow-soft backdrop-blur-sm">
            <PanelHeader
              eyebrow="Performance"
              title="Funil de Conversão da Equipe"
              description="Acompanhamento visual da recuperação de agenda."
              badge="BI"
            />
            <div className="space-y-6">
              <div>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-semibold text-slate-600">Conversão em reagendamento</span>
                  <span className="font-bold text-[#00A896]">{metrics.conversionRate.toFixed(1)}%</span>
                </div>
                <div className="h-4 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-[#00A896] transition-all duration-500"
                    style={{ width: `${Math.min(metrics.conversionRate, 100)}%` }}
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  ["Faltosos", metrics.total, "bg-[#0A2540]"],
                  ["Em tratativa", metrics.inProgress, "bg-[#F59E0B]"],
                  ["Convertidos", metrics.rescheduled, "bg-[#10B981]"],
                ].map(([label, value, className]) => (
                  <div key={label} className="rounded-2xl border border-slate-100 bg-gradient-to-b from-slate-50 to-white p-4 shadow-sm">
                    <div className={`mb-3 h-2 w-12 rounded-full ${className}`} />
                    <p className="text-sm text-slate-500">{label}</p>
                    <strong className="text-2xl font-black text-[#0A2540]">{value}</strong>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-[1.75rem] border border-slate-100 bg-white/95 shadow-soft backdrop-blur-sm">
          <div className="flex flex-col gap-2 border-b border-slate-100/80 bg-gradient-to-r from-slate-50 to-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <PanelHeader
                eyebrow="Detalhe operacional"
                title="Lista de Pacientes"
                description={`${filteredRecords.length} registros encontrados com os filtros atuais.`}
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-left text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50/95 text-xs uppercase tracking-wide text-slate-500 backdrop-blur">
                <tr>
                  <th className="px-5 py-4 font-bold">Data</th>
                  <th className="px-5 py-4 font-bold">Unidade</th>
                  <th className="px-5 py-4 font-bold">Pagamento</th>
                  <th className="px-5 py-4 font-bold">Paciente</th>
                  <th className="px-5 py-4 font-bold">Telefone</th>
                  <th className="px-5 py-4 font-bold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredRecords.map((record, index) => (
                  <tr key={record.id} className={`transition duration-200 hover:-translate-y-[1px] hover:bg-cyan-50/50 ${index % 2 === 0 ? "bg-white" : "bg-slate-50/30"}`}>
                    <td className="whitespace-nowrap px-5 py-4 text-slate-600">{record.date || "-"}</td>
                    <td className="whitespace-nowrap px-5 py-4 font-medium text-slate-700">{record.unit || "-"}</td>
                    <td className="whitespace-nowrap px-5 py-4 text-slate-600" title={record.paymentMethod || ""}>
                      {record.paymentMethod || "-"}
                    </td>
                    <td className="min-w-56 px-5 py-4 font-semibold text-[#0A2540]">{record.patient || "-"}</td>
                    <td className="whitespace-nowrap px-5 py-4 text-slate-600">{record.phone || "-"}</td>
                    <td className="whitespace-nowrap px-5 py-4">
                      <StatusBadge status={record.status} label={record.statusLabel} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!filteredRecords.length && !loading && (
            <div className="px-5 py-12 text-center text-sm text-slate-400">
              Nenhum paciente encontrado para os filtros selecionados.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
