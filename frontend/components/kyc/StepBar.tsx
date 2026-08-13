'use client';

import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

const STEPS = [
  { id: 1, label: 'Connect Wallet' },
  { id: 2, label: 'Upload ID' },
  { id: 3, label: 'Face Check' },
  { id: 4, label: 'Verified' },
];

interface StepBarProps {
  currentStep: number;
  className?: string;
}

export function StepBar({ currentStep, className }: StepBarProps) {
  return (
    <div className={cn('flex items-center w-full', className)}>
      {STEPS.map((step, idx) => {
        const done = currentStep > step.id;
        const active = currentStep === step.id;

        return (
          <div key={step.id} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-all duration-300',
                  done && 'bg-[#534AB7] text-white',
                  active && 'bg-[#534AB7] text-white ring-4 ring-[#534AB7]/15',
                  !done && !active && 'bg-gray-100 text-gray-400 border border-gray-200'
                )}
                style={{ borderWidth: done || active ? 0 : '0.5px' }}
              >
                {done ? <Check className="w-4 h-4 stroke-[2.5]" /> : step.id}
              </div>
              <span
                className={cn(
                  'text-[11px] font-medium whitespace-nowrap',
                  active ? 'text-[#534AB7]' : done ? 'text-gray-600' : 'text-gray-400'
                )}
              >
                {step.label}
              </span>
            </div>
            {idx < STEPS.length - 1 && (
              <div
                className={cn(
                  'flex-1 h-px mx-3 mb-5 transition-all duration-300',
                  currentStep > step.id ? 'bg-[#534AB7]' : 'bg-gray-200'
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
