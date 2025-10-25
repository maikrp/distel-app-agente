import React from "react";

export default function Card({ children, className = "" }) {
  return (
    <div
      className={`bg-white rounded-2xl shadow-md p-4 mb-3 ${className}`}
    >
      {children}
    </div>
  );
}
