import { getImageProps } from "next/image";

type ProductShotProps = {
  src: string;
  /** The same view in the dark appearance. A device in dark mode gets this file. */
  darkSrc?: string;
  alt: string;
  width: number;
  height: number;
  /** Tailwind classes for the aspect ratio of the visible area. */
  aspectClassName?: string;
  /** Load the image before the rest of the page. Use it for the image at the top of a page. */
  priority?: boolean;
  /** The `sizes` attribute of the image. */
  sizes?: string;
  className?: string;
};

/**
 * Shows a product screenshot in a frame with a thin border.
 * A frame that is narrower than the screenshot shows the top left part.
 */
export function ProductShot({
  src,
  darkSrc,
  alt,
  width,
  height,
  aspectClassName = "aspect-[16/10]",
  priority = false,
  sizes = "(min-width: 1280px) 1136px, 100vw",
  className = "",
}: ProductShotProps) {
  const common = { alt, width, height, sizes, priority };
  const { props } = getImageProps({ ...common, src });
  const dark = darkSrc ? getImageProps({ ...common, src: darkSrc }).props : null;

  return (
    <figure
      className={`overflow-hidden rounded-lg border border-border bg-surface shadow-dialog ${className}`}
    >
      <div className={`relative w-full ${aspectClassName}`}>
        <picture>
          {dark ? (
            <source
              media="(prefers-color-scheme: dark)"
              srcSet={dark.srcSet ?? dark.src}
              sizes={dark.sizes}
            />
          ) : null}
          <img
            {...props}
            alt={alt}
            className="absolute inset-0 h-full w-full object-cover object-left-top"
          />
        </picture>
      </div>
    </figure>
  );
}
