// Authentic Mochy Music Vector Marks — ported directly from drawable/nav_mochy_filled.xml & nav_mochy_outline.xml

import React from 'react';
import Svg, { Path } from 'react-native-svg';

export const MochyMarkIcon: React.FC<{
  size?: number;
  color?: string;
  filled?: boolean;
}> = ({ size = 24, color = '#FFFFFF', filled = false }) => {
  if (filled) {
    return (
      <Svg width={size} height={size} viewBox="55.67 50.42 135.16 135.16">
          <Path
            fill={color}
            fillRule="nonzero"
            d="M167.25 89.854Q175.118 94.397 179.435 102.186Q183.5 109.52 183.5 118Q183.5 126.48 179.435 133.814Q175.911 140.172 170.022 144.367C170.505 143.937 170.697 143.632 170.5 143.5C169.27 143.5 148.191 143.836 140.653 143.957C133.656 142.69 128.068 139.616 123.933 136.046C118.758 131.578 116.223 126.672 115.735 124.009C115.187 121.021 112.321 119.043 109.333 119.59C106.346 120.138 104.367 123.003 104.915 125.991C105.973 131.768 110.238 138.754 116.745 144.372C123.411 150.128 132.822 154.806 144.683 155.491C144.789 155.497 144.894 155.5 145 155.5H150.859L150.907 155.582L111.75 178.189Q103.882 182.731 94.978 182.576Q86.594 182.429 79.25 178.189Q71.906 173.949 67.587 166.761Q63 159.128 63 150.043V85.957Q63 76.872 67.587 69.239Q71.906 62.051 79.25 57.811Q86.594 53.571 94.978 53.425Q103.882 53.269 111.75 57.811ZM92.75 108.509Q91.304 110.269 91.526 112.537Q91.749 114.804 93.509 116.25Q95.269 117.696 97.537 117.474Q99.804 117.251 101.25 115.491L108.5 106.665L115.75 115.491Q117.196 117.251 119.463 117.474Q121.731 117.696 123.491 116.25Q125.251 114.804 125.474 112.537Q125.696 110.269 124.25 108.509L112.75 94.509Q112.408 94.092 111.991 93.75Q110.231 92.304 107.963 92.526Q105.696 92.749 104.25 94.509Z"
          />
      </Svg>
    );
  }

  return (
    <Svg width={size} height={size} viewBox="55.67 50.42 135.16 135.16">
        <Path
          d="M163.5 96.3493C180.167 105.972 180.167 130.028 163.5 139.651L108 171.694C91.3333 181.316 70.5 169.288 70.5 150.043V85.9569C70.5 66.7119 91.3333 54.6838 108 64.3063L163.5 96.3493Z"
          fill="none"
          stroke={color}
          strokeWidth={18}
          strokeLinejoin="round"
        />
        <Path
          d="M97 112L108.5 98L120 112"
          fill="none"
          stroke={color}
          strokeWidth={11}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path
          d="M110.325 125C111.871 133.439 121.868 148.704 142.944 149.92"
          fill="none"
          stroke={color}
          strokeWidth={11}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
    </Svg>
  );
};

export function formatTimeSec(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}
