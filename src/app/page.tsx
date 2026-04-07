"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface Lead {
  podcast_name: string;
  host: string;
  contact_email: string;
  website: string;
  podcast_link: string;
  category: string;
  notes: string;
}

const STORAGE_KEY = "podcast-lead-finder-history";

function getHistory(): Record<string, Lead[]> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveHistory(history: Record<string, Lead[]>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

export default function Home() {
  const [niche, setNiche] = useState("");
  const [leadCount, setLeadCount] = useState(25);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [pastLeads, setPastLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [streamText, setStreamText] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Build a stable key from first 100 chars of the bio
  const getBioKey = useCallback((bio: string) => {
    return bio.trim().slice(0, 100).toLowerCase().replace(/\s+/g, " ");
  }, []);

  // Extract a filename-friendly name from the bio (coach name or first 3 words)
  const getCoachName = useCallback((bio: string) => {
    const trimmed = bio.trim();
    // Try to extract a name pattern like "John Smith is a..." or "John Smith,"
    const nameMatch = trimmed.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)(?:\s+is\b|\s*,|\s*-)/);
    if (nameMatch) {
      return nameMatch[1].replace(/\s+/g, "_");
    }
    // Fallback: first 3 words
    return trimmed.split(/\s+/).slice(0, 3).join("_").replace(/[^a-zA-Z0-9_]/g, "");
  }, []);

  // Load past leads when niche changes
  useEffect(() => {
    if (!niche.trim()) {
      setPastLeads([]);
      return;
    }
    const key = getBioKey(niche);
    const history = getHistory();
    const existing = history[key] || [];
    setPastLeads(existing);
  }, [niche, getBioKey]);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!niche.trim()) return;

    setLoading(true);
    setError("");
    setLeads([]);
    setStreamText("");

    abortRef.current = new AbortController();

    // Get existing leads to exclude
    const key = getBioKey(niche);
    const history = getHistory();
    const existingLeads = history[key] || [];
    const exclude = existingLeads.map((l) => l.podcast_name);

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          niche: niche.trim(),
          count: leadCount,
          exclude,
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Search failed");
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data);
              if (parsed.type === "status") {
                setStreamText(parsed.message);
              } else if (parsed.type === "leads") {
                setLeads(parsed.leads);
                // Save new leads to history
                const updatedHistory = getHistory();
                const prev = updatedHistory[key] || [];
                updatedHistory[key] = [...prev, ...parsed.leads];
                saveHistory(updatedHistory);
                setPastLeads(updatedHistory[key]);
              } else if (parsed.type === "text") {
                fullText += parsed.content;
                setStreamText(fullText.slice(-200));
              } else if (parsed.type === "error") {
                setError(parsed.message);
              }
            } catch {
              // skip malformed chunks
            }
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        setError(err.message);
      }
    } finally {
      setLoading(false);
      setStreamText("");
    }
  }

  function downloadCSV(leadsToExport: Lead[], filename: string) {
    if (leadsToExport.length === 0) return;

    const headers = [
      "No.",
      "Podcast Name",
      "Host",
      "Contact Email",
      "Website",
      "Podcast Link",
      "Category",
      "Notes",
    ];

    const escape = (val: string) => {
      if (val.includes(",") || val.includes('"') || val.includes("\n")) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    };

    const rows = leadsToExport.map((lead, i) =>
      [
        String(i + 1),
        lead.podcast_name,
        lead.host,
        lead.contact_email,
        lead.website,
        lead.podcast_link,
        lead.category,
        lead.notes,
      ]
        .map(escape)
        .join(",")
    );

    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function clearHistory() {
    const key = getBioKey(niche);
    const history = getHistory();
    delete history[key];
    saveHistory(history);
    setPastLeads([]);
  }

  return (
    <main className="max-w-7xl mx-auto px-4 py-12">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold mb-3">
          Podcast Lead Finder
        </h1>
        <p className="text-gray-400 text-lg">
          Paste a coach&apos;s bio and get podcast guest opportunities with real contact emails
        </p>
      </div>

      <form onSubmit={handleSearch} className="max-w-2xl mx-auto mb-12">
        <div className="flex flex-col gap-4">
          <textarea
            value={niche}
            onChange={(e) => setNiche(e.target.value)}
            placeholder={"Paste the coach's full bio or niche description here...\n\ne.g. \"Sharee Wells is a career coach who works with professionals seeking better salaries, benefits, raises, promotions, and growth opportunities...\""}
            rows={6}
            className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y"
            disabled={loading}
          />

          {pastLeads.length > 0 && (
            <div className="px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg space-y-3">
              <p className="text-sm text-gray-300 font-medium">
                {pastLeads.length} leads already found for this coach. New search will find different ones.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowHistory(!showHistory)}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {showHistory ? "Hide Past Leads" : "View All Past Leads"}
                </button>
                <button
                  type="button"
                  onClick={() => downloadCSV(
                    pastLeads,
                    `all_podcast_leads_${getCoachName(niche)}.csv`
                  )}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Download All CSV
                </button>
                <button
                  type="button"
                  onClick={clearHistory}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Reset History
                </button>
              </div>
            </div>
          )}

          <div className="flex gap-4 items-center">
            <label className="text-sm text-gray-400 whitespace-nowrap">
              Number of leads:
            </label>
            <select
              value={leadCount}
              onChange={(e) => setLeadCount(Number(e.target.value))}
              className="px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={loading}
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <button
              type="submit"
              disabled={loading || !niche.trim()}
              className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white font-medium rounded-lg transition-colors"
            >
              {loading ? "Searching..." : pastLeads.length > 0 ? "Find More Leads" : "Find Leads"}
            </button>
          </div>
        </div>
      </form>

      {loading && streamText && (
        <div className="max-w-2xl mx-auto mb-8 p-4 bg-gray-900 border border-gray-800 rounded-lg">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-2 w-2 bg-blue-500 rounded-full animate-pulse" />
            <span className="text-sm text-gray-400">Searching for podcasts...</span>
          </div>
          <p className="text-sm text-gray-500 font-mono truncate">{streamText}</p>
        </div>
      )}

      {error && (
        <div className="max-w-2xl mx-auto mb-8 p-4 bg-red-950 border border-red-800 rounded-lg text-red-300">
          {error}
        </div>
      )}

      {showHistory && pastLeads.length > 0 && !loading && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">
              All Leads ({pastLeads.length} total)
            </h2>
            <button
              onClick={() => downloadCSV(
                pastLeads,
                `all_podcast_leads_${getCoachName(niche)}.csv`
              )}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Download All CSV
            </button>
          </div>
          <div className="overflow-x-auto rounded-lg border border-gray-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-900 text-gray-400 text-left">
                  <th className="px-4 py-3 font-medium">#</th>
                  <th className="px-4 py-3 font-medium">Podcast</th>
                  <th className="px-4 py-3 font-medium">Host</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Notes</th>
                  <th className="px-4 py-3 font-medium">Links</th>
                </tr>
              </thead>
              <tbody>
                {pastLeads.map((lead, i) => (
                  <tr key={i} className="border-t border-gray-800 hover:bg-gray-900/50">
                    <td className="px-4 py-3 text-gray-500">{i + 1}</td>
                    <td className="px-4 py-3 font-medium">{lead.podcast_name}</td>
                    <td className="px-4 py-3 text-gray-300">{lead.host}</td>
                    <td className="px-4 py-3">
                      <a href={`mailto:${lead.contact_email}`} className="text-blue-400 hover:text-blue-300">
                        {lead.contact_email}
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 bg-gray-800 rounded text-xs text-gray-300">{lead.category}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 max-w-xs truncate">{lead.notes}</td>
                    <td className="px-4 py-3 space-x-2">
                      {lead.website && (
                        <a href={lead.website} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 text-xs">Web</a>
                      )}
                      {lead.podcast_link && (
                        <a href={lead.podcast_link} target="_blank" rel="noopener noreferrer" className="text-green-400 hover:text-green-300 text-xs">Listen</a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {leads.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">
              {leads.length} New Lead{leads.length !== 1 ? "s" : ""} Found
            </h2>
            <button
              onClick={() => downloadCSV(
                leads,
                `podcast_leads_${getCoachName(niche)}.csv`
              )}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Download CSV
            </button>
          </div>

          <div className="overflow-x-auto rounded-lg border border-gray-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-900 text-gray-400 text-left">
                  <th className="px-4 py-3 font-medium">#</th>
                  <th className="px-4 py-3 font-medium">Podcast</th>
                  <th className="px-4 py-3 font-medium">Host</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Notes</th>
                  <th className="px-4 py-3 font-medium">Links</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead, i) => (
                  <tr
                    key={i}
                    className="border-t border-gray-800 hover:bg-gray-900/50"
                  >
                    <td className="px-4 py-3 text-gray-500">{i + 1}</td>
                    <td className="px-4 py-3 font-medium">{lead.podcast_name}</td>
                    <td className="px-4 py-3 text-gray-300">{lead.host}</td>
                    <td className="px-4 py-3">
                      <a
                        href={`mailto:${lead.contact_email}`}
                        className="text-blue-400 hover:text-blue-300"
                      >
                        {lead.contact_email}
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 bg-gray-800 rounded text-xs text-gray-300">
                        {lead.category}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 max-w-xs truncate">
                      {lead.notes}
                    </td>
                    <td className="px-4 py-3 space-x-2">
                      {lead.website && (
                        <a
                          href={lead.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:text-blue-300 text-xs"
                        >
                          Web
                        </a>
                      )}
                      {lead.podcast_link && (
                        <a
                          href={lead.podcast_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-green-400 hover:text-green-300 text-xs"
                        >
                          Listen
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}
