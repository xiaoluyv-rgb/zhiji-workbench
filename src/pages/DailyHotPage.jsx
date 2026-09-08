import { PageHeader } from "../components/PageHeader";
import {
  HotAutoSection,
  HotCreativeSection,
  HotPlatformSection,
} from "../components/daily-hot/hot-layers";
import "../components/daily-hot/daily-hot.css";

export function DailyHotPage() {
  return (
    <div className="page page--daily-hot">
      <PageHeader
        eyebrow="TRENDING SIGNALS · 微博 / 抖音"
        title="每日热点"
      />

      <div className="daily-hot-extended">
        <HotPlatformSection />
        <HotAutoSection />
        <HotCreativeSection />
      </div>
    </div>
  );
}
