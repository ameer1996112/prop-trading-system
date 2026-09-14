"use client";

import { ExecutionQualityPage } from "./ExecutionQualityPage";
import { AlertsPage } from "./AlertsPage";
import { PropFirmPage } from "./PropFirmPage";
import { AlertSetupPage } from "./AlertSetupPage";
import { OptimizerPage } from "./OptimizerPage";
import { StrategiesPage } from "./StrategiesPage";
import { NotificationsPage } from "./NotificationsPage";
import { SettingsPage } from "./SettingsPage";

export function OriginalServicePage({ view }: { view: string }) {
  switch (view) {
    case "execution-quality": return <ExecutionQualityPage />;
    case "alerts": return <AlertsPage />;
    case "prop-firm": return <PropFirmPage />;
    case "alert-setup": return <AlertSetupPage />;
    case "optimizer": return <OptimizerPage />;
    case "strategies": return <StrategiesPage />;
    case "notifications": return <NotificationsPage />;
    case "settings": return <SettingsPage />;
    default: return null;
  }
}
