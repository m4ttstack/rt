import type {
  GateOption as RtGateOption,
  GateQuestion as RtGateQuestion,
} from '@mattstack/rt-client/gate';

/** `description` (per option) and `context` (per question) ahead of
    rt-client publishing them (RT-180). Both optional, so a gate that
    doesn't send either field keeps rendering exactly as before. */
export type GateOption =
  string | (Extract<RtGateOption, object> & { description?: string });

export interface GateQuestion extends Omit<RtGateQuestion, 'options'> {
  options: GateOption[];
  context?: string;
}
