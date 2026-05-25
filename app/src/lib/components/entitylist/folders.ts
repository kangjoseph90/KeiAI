export const COLOR_CLASSES: Record<string, string> = {
    red: 'text-red-500 fill-red-500/10 border-red-500/20 bg-red-500/5',
    orange: 'text-orange-500 fill-orange-500/10 border-orange-500/20 bg-orange-500/5',
    yellow: 'text-amber-500 fill-amber-500/10 border-amber-500/20 bg-amber-500/5',
    green: 'text-emerald-500 fill-emerald-500/10 border-emerald-500/20 bg-emerald-500/5',
    blue: 'text-blue-500 fill-blue-500/10 border-blue-500/20 bg-blue-500/5',
    indigo: 'text-indigo-500 fill-indigo-500/10 border-indigo-500/20 bg-indigo-500/5',
    purple: 'text-purple-500 fill-purple-500/10 border-purple-500/20 bg-purple-500/5',
    pink: 'text-pink-500 fill-pink-500/10 border-pink-500/20 bg-pink-500/5'
};

export function getFolderColorClass(color?: string): string {
    return (
        (color && COLOR_CLASSES[color]) ||
        'text-muted-foreground fill-muted-foreground/10 border-muted bg-muted/5'
    );
}

export const GROUP_COLOR_CLASSES: Record<string, string> = {
    red: 'border-red-500/20 bg-red-500/5',
    orange: 'border-orange-500/20 bg-orange-500/5',
    yellow: 'border-amber-500/20 bg-amber-500/5',
    green: 'border-emerald-500/20 bg-emerald-500/5',
    blue: 'border-blue-500/20 bg-blue-500/5',
    indigo: 'border-indigo-500/20 bg-indigo-500/5',
    purple: 'border-purple-500/20 bg-purple-500/5',
    pink: 'border-pink-500/20 bg-pink-500/5'
};

export function getFolderGroupClass(color?: string): string {
    const colorClass = color && GROUP_COLOR_CLASSES[color];
    if (colorClass) {
        return `border ${colorClass} rounded-lg`;
    }
    return 'border border-sidebar-border bg-muted/10 rounded-lg';
}

export const COLOR_BG_CLASSES: Record<string, string> = {
    red: 'bg-red-500',
    orange: 'bg-orange-500',
    yellow: 'bg-amber-500',
    green: 'bg-emerald-500',
    blue: 'bg-blue-500',
    indigo: 'bg-indigo-500',
    purple: 'bg-purple-500',
    pink: 'bg-pink-500'
};

export const COLOR_PRESETS = [
    'red',
    'orange',
    'yellow',
    'green',
    'blue',
    'indigo',
    'purple',
    'pink'
] as const;
