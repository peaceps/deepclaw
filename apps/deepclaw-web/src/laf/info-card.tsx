'use client';

import { useTranslation } from "react-i18next";
import { colorClassMap, DeepColors } from "./laf-types";

type InfoCardProps = {
    title: string;
    icon: React.ReactNode;
    children: React.ReactNode;
    color: DeepColors;
  }
  
export function InfoCard({ title, icon, children, color }: InfoCardProps) {
    const {t} = useTranslation();
    const classes = colorClassMap[color];
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className={classes.text}>{icon}</div>
          <h3 className="font-semibold text-gray-900">{t(title)}</h3>
        </div>
        {children}
      </div>
    );
}
