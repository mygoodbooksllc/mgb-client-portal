import React from "react";
import { WarningIcon } from "./WarningIcon";
import { SearchIcon } from "./SearchIcon";
import { LockIcon } from "./LockIcon";
import { PaperclipIcon } from "./PaperclipIcon";
import { FlaskIcon } from "./FlaskIcon";
import { SunIcon } from "./SunIcon";
import { MoonIcon } from "./MoonIcon";
import { SlidersIcon } from "./SlidersIcon";
import { ChatIcon } from "./ChatIcon";
import { DocumentIcon } from "./DocumentIcon";
import { BarChartIcon } from "./BarChartIcon";
import { ShieldCheckIcon } from "./ShieldCheckIcon";
import { LightbulbIcon } from "./LightbulbIcon";
import { HomeIcon } from "./HomeIcon";
import { UsersIcon } from "./UsersIcon";
import { ClientRosterIcon } from "./ClientRosterIcon";
import { GridIcon } from "./GridIcon";
import { PieChartIcon } from "./PieChartIcon";
import { BankIcon } from "./BankIcon";
import { SwapIcon } from "./SwapIcon";
import { CalculatorIcon } from "./CalculatorIcon";
import { StackedBillsIcon } from "./StackedBillsIcon";
import { DownloadIcon } from "./DownloadIcon";
import { GiftHeartIcon } from "./GiftHeartIcon";
import { FolderIcon } from "./FolderIcon";
import { WrenchIcon } from "./WrenchIcon";
import { ChevronUpIcon } from "./ChevronUpIcon";
import { ChevronDownIcon } from "./ChevronDownIcon";
import { UploadIcon } from "./UploadIcon";
import { FileIcon } from "./FileIcon";

/** One entry in {@link IconGallery}'s grid. */
export interface IconGalleryEntry {
  name: string;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}

/**
 * Every icon in the house style (thin-line, `stroke="currentColor"`, no
 * emoji), in the order they were introduced across the app. Kept here
 * rather than derived from the barrel export so the gallery's order and
 * labels stay stable even if index.ts's export order changes.
 */
export const ICON_GALLERY_ENTRIES: IconGalleryEntry[] = [
  { name: "WarningIcon", Icon: WarningIcon },
  { name: "SearchIcon", Icon: SearchIcon },
  { name: "LockIcon", Icon: LockIcon },
  { name: "PaperclipIcon", Icon: PaperclipIcon },
  { name: "FlaskIcon", Icon: FlaskIcon },
  { name: "SunIcon", Icon: SunIcon },
  { name: "MoonIcon", Icon: MoonIcon },
  { name: "SlidersIcon", Icon: SlidersIcon },
  { name: "ChatIcon", Icon: ChatIcon },
  { name: "DocumentIcon", Icon: DocumentIcon },
  { name: "BarChartIcon", Icon: BarChartIcon },
  { name: "ShieldCheckIcon", Icon: ShieldCheckIcon },
  { name: "LightbulbIcon", Icon: LightbulbIcon },
  { name: "HomeIcon", Icon: HomeIcon },
  { name: "UsersIcon", Icon: UsersIcon },
  { name: "ClientRosterIcon", Icon: ClientRosterIcon },
  { name: "GridIcon", Icon: GridIcon },
  { name: "PieChartIcon", Icon: PieChartIcon },
  { name: "BankIcon", Icon: BankIcon },
  { name: "SwapIcon", Icon: SwapIcon },
  { name: "CalculatorIcon", Icon: CalculatorIcon },
  { name: "StackedBillsIcon", Icon: StackedBillsIcon },
  { name: "DownloadIcon", Icon: DownloadIcon },
  { name: "GiftHeartIcon", Icon: GiftHeartIcon },
  { name: "FolderIcon", Icon: FolderIcon },
  { name: "WrenchIcon", Icon: WrenchIcon },
  { name: "ChevronUpIcon", Icon: ChevronUpIcon },
  { name: "ChevronDownIcon", Icon: ChevronDownIcon },
  { name: "UploadIcon", Icon: UploadIcon },
  { name: "FileIcon", Icon: FileIcon },
];

/**
 * Every icon in the design system, laid out in a grid with its component
 * name underneath — a reference sheet for browsing what's available before
 * reaching for a new one. Reads its own tokens from styles.css (`--navy`,
 * `--gold`, `--surface`, `--border`), so it renders correctly wherever this
 * package's stylesheet is loaded, independent of the parent app.
 */
export function IconGallery() {
  return (
    <div className="icon-gallery">
      {ICON_GALLERY_ENTRIES.map(({ name, Icon }) => (
        <div className="icon-gallery-item" key={name}>
          <div className="icon-gallery-swatch">
            <Icon width={20} height={20} />
          </div>
          <span className="icon-gallery-name">{name}</span>
        </div>
      ))}
    </div>
  );
}
