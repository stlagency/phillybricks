/**
 * Bandbox component kit barrel. See ./README.md for the API-wiring map
 * (which props will later come from /api/parcel/:pk, /api/scan, etc.).
 */
export { TopBand } from './TopBand';
export type { TopBandProps, NavItem } from './TopBand';
export { Wordmark } from './Wordmark';
export type { WordmarkProps, WordmarkVariant } from './Wordmark';
export { ThemeToggle } from './ThemeToggle';
export type { ThemeToggleProps } from './ThemeToggle';

export { Card } from './Card';
export type { CardProps } from './Card';
export { MetricStrip, MetricCell } from './MetricStrip';
export type { MetricStripProps, MetricCellProps, MetricEmphasis } from './MetricStrip';
export { Pill } from './Pill';
export type { PillProps, PillKind } from './Pill';
export { Button } from './Button';
export type { ButtonProps, ButtonVariant } from './Button';

export { Ledger, LedgerHead, LedgerBody, NumCell, LabelCell } from './Ledger';
export type { LedgerProps } from './Ledger';

export { SourceStamp } from './SourceStamp';
export type { SourceStampProps } from './SourceStamp';
export { GlossaryTerm } from './GlossaryTerm';
export type { GlossaryTermProps } from './GlossaryTerm';
export {
  ContextRail,
  RailProvider,
  useRail,
  GLOSSARY,
  SOURCE_LABELS,
} from './ContextRail';
export type { ContextRailProps, RailDefinition } from './ContextRail';

export { DistressBar } from './DistressBar';
export type { DistressBarProps } from './DistressBar';
export { DistressBlock } from './DistressBlock';
export type { DistressBlockProps } from './DistressBlock';
export { ValueDerivationDrawer } from './ValueDerivationDrawer';
export type { ValueDerivationDrawerProps } from './ValueDerivationDrawer';

export { LensSwitcher } from './LensSwitcher';
export type { LensSwitcherProps } from './LensSwitcher';
export { BlueprintMap } from './BlueprintMap';
export type { BlueprintMapProps } from './BlueprintMap';
export { MapLegend } from './MapLegend';
export { TimeStrip } from './TimeStrip';
export type { TimeStripProps } from './TimeStrip';
export { FilterRail } from './FilterRail';
export type { FilterRailProps, FilterRailValue } from './FilterRail';
export { LeadsTable } from './LeadsTable';
export type { LeadsTableProps } from './LeadsTable';
export { SkipTraceButton } from './SkipTraceButton';
export type { SkipTraceButtonProps } from './SkipTraceButton';
export { TrendChart } from './TrendChart';
export type { TrendChartProps, TrendBar } from './TrendChart';
export { CommunitySignal } from './CommunitySignal';
export type { CommunitySignalProps } from './CommunitySignal';
