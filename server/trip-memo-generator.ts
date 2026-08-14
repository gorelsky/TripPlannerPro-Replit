import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";

import type { TripWithDetails } from "@shared/schema";

export type TripMemoKind = "unplanned" | "cancel" | "reschedule" | "change";

export type TripMemoInput = {
  reason?: string;
  place?: string;
  travelCost?: string;
  accommodationCost?: string;
  otherCost?: string;
  newStartDate?: string;
  newEndDate?: string;
  newPurpose?: string;
};

const TEMPLATE_FILES: Record<TripMemoKind, string> = {
  unplanned: "Шаблон СЗ на внеплановую командировки.docx",
  cancel: "Шаблон СЗ на отмену командировки.docx",
  reschedule: "Шаблон СЗ на перенос командировки..docx",
  change: "Шаблон СЗ на изменение условий командировки.docx",
};

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function paragraphText(xml: string) {
  return xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br\/>/g, "\n")
    .replace(/<w:t[^>]*>/g, "")
    .replace(/<\/w:t>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function replaceParagraphText(original: string, value: string) {
  const pPr = original.match(/<w:pPr[\s\S]*?<\/w:pPr>/)?.[0] ?? "";
  const rPr = original.match(/<w:rPr[\s\S]*?<\/w:rPr>/)?.[0] ?? "";
  const content = value.split("\n").map((line, index) =>
    `${index ? "<w:br/>" : ""}<w:t xml:space=\"preserve\">${escapeXml(line)}</w:t>`,
  ).join("");
  return `<w:p>${pPr}<w:r>${rPr}${content}</w:r></w:p>`;
}

function updateParagraphs(xml: string, updater: (text: string) => string | undefined) {
  return xml.replace(/<w:p(?: [^>]*)?>[\s\S]*?<\/w:p>/g, (paragraph) => {
    const nextText = updater(paragraphText(paragraph));
    return nextText === undefined ? paragraph : replaceParagraphText(paragraph, nextText);
  });
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}.${month}.${year}` : value;
}

function getDestination(trip: TripWithDetails) {
  if (trip.city?.name) return trip.city.name;
  const routeCities = trip.route.cities || [];
  const intermediate = routeCities.length > 2 ? routeCities.slice(1, -1) : routeCities.slice(1);
  return intermediate.join(", ") || trip.route.path;
}

function createFileName(kind: TripMemoKind, trip: TripWithDetails) {
  const labels: Record<TripMemoKind, string> = {
    unplanned: "СЗ_внеплановая",
    cancel: "СЗ_отмена",
    reschedule: "СЗ_перенос",
    change: "СЗ_изменение_условий",
  };
  return `${labels[kind]}_${trip.employee.fullName.replace(/\s+/g, "_")}_${trip.startDate}.docx`;
}

export async function generateTripMemo(trip: TripWithDetails, kind: TripMemoKind, input: TripMemoInput) {
  const templatePath = path.resolve(import.meta.dirname, "..", "attached_assets", TEMPLATE_FILES[kind]);
  const zip = await JSZip.loadAsync(fs.readFileSync(templatePath));
  const documentXml = zip.file("word/document.xml");
  if (!documentXml) throw new Error("Word template is missing document.xml");

  const destination = getDestination(trip);
  const originalStart = formatDate(trip.startDate);
  const originalEnd = formatDate(trip.endDate);
  const author = `${trip.employee.fullName}\n${trip.employee.jobTitle || ""}`.trim();
  let xml = await documentXml.async("string");
  xml = updateParagraphs(xml, (text) => {
    if (text.includes("Судхир Кумар Сингх") && text.includes("должность")) {
      return `Судхир Кумар Сингх\nот ${author}`;
    }
    if (kind === "unplanned" && text.includes("во внеплановую служебную командировку")) {
      return `во внеплановую служебную командировку в г. ${destination} на период с ${originalStart} по ${originalEnd}`;
    }
    if (kind === "unplanned" && text.startsWith("Цель командировки:")) {
      return `Цель командировки: ${trip.purpose}`;
    }
    if (kind === "unplanned" && text.startsWith("Обоснование внепланового характера")) {
      return `Обоснование внепланового характера командировки: ${input.reason || trip.unplannedReason || ""}`;
    }
    if (kind === "unplanned" && text.startsWith("Предполагаемое место пребывания")) {
      return `Предполагаемое место пребывания (организация, подразделение, объект): ${input.place || ""}`;
    }
    if (kind === "unplanned" && text.startsWith("Предполагаемые расходы")) {
      return `Предполагаемые расходы (при наличии): проезд ${input.travelCost || ""}`;
    }
    if (kind === "unplanned" && text.startsWith("проживание")) {
      return `проживание ${input.accommodationCost || ""}, прочие расходы ${input.otherCost || ""}`;
    }
    if (kind === "cancel" && text.startsWith("Прошу отменить ранее утверждённую")) {
      return `Прошу отменить ранее утверждённую служебную командировку в г. ${destination}, запланированную на период с ${originalStart} по ${originalEnd}`;
    }
    if (kind === "cancel" && text.startsWith("Причина отмены командировки:")) {
      return `Причина отмены командировки: ${input.reason || ""}`;
    }
    if (kind === "reschedule" && text.startsWith("Прошу перенести мою служебную")) {
      return `Прошу перенести мою служебную командировку в г. ${destination}, первоначально запланированную на период с ${originalStart} по ${originalEnd}`;
    }
    if (kind === "reschedule" && text.startsWith("на новый срок:")) {
      return `на новый срок: с ${formatDate(input.newStartDate || "")} по ${formatDate(input.newEndDate || "")}`;
    }
    if (kind === "reschedule" && text.startsWith("Причина переноса:")) {
      return `Причина переноса: ${input.reason || ""}`;
    }
    if (kind === "reschedule" && text.startsWith("Первоначальная цель командировки:")) {
      return `Первоначальная цель командировки: ${trip.purpose}\nПредлагаемые изменения (при наличии):`;
    }
    if (kind === "change" && text.includes("Судхир Кумар Сингх") && text.includes("Место для ввода текста")) {
      return `Судхир Кумар Сингх\nот ${author}`;
    }
    if (kind === "change" && text.startsWith("Прошу внести изменения в ранее утверждённую")) {
      return `Прошу внести изменения в ранее утверждённую служебную командировку в г. ${destination}, запланированную на период с ${originalStart} по ${originalEnd}`;
    }
    if (kind === "change" && text.includes("новое направление")) {
      return `– новое направление (город, регион): ${input.place || ""}`;
    }
    if (kind === "change" && text.startsWith("- новый срок командировки:")) {
      return `- новый срок командировки: с ${formatDate(input.newStartDate || "")} по ${formatDate(input.newEndDate || "")}`;
    }
    if (kind === "change" && text.includes("изменение цели командировки")) {
      return `– изменение цели командировки: ${input.newPurpose || ""}`;
    }
    if (kind === "change" && text.startsWith("Причина изменения:")) {
      return `Причина изменения: ${input.reason || ""}`;
    }
    return undefined;
  });

  zip.file("word/document.xml", xml);
  return {
    buffer: await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
    fileName: createFileName(kind, trip),
  };
}
