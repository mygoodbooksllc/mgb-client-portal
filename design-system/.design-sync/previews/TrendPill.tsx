import React from 'react';
import { TrendPill } from 'mygoodbooks-ds';

export const Positive = () => <TrendPill current={63500} prior={59800} goodDir="up" />;

export const Negative = () => <TrendPill current={55100} prior={52900} goodDir="down" />;

export const Flat = () => <TrendPill current={4820.3} prior={4805.1} goodDir="up" />;

export const NoPriorPeriod = () => <TrendPill current={35850.55} prior={null} goodDir="up" />;
