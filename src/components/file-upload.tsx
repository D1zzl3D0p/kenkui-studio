interface FileUploadProps { file?: File; formats: string[]; onChange(file?: File): void }

const sourceAccept: Record<string, string> = {
  epub: "application/epub+zip,.epub",
  pdf: "application/pdf,.pdf",
};

export function FileUpload({ file, formats, onChange }: FileUploadProps) {
  const label = `${formats.map((format) => format.toUpperCase()).join(" / ") || "Source"} source`;
  const accept = formats.map((format) => sourceAccept[format] ?? `.${format}`).join(",");
  return <label>{label}<input aria-label={label} type="file" accept={accept} onChange={(event) => onChange(event.target.files?.[0])} />{file && <span>{file.name}</span>}</label>;
}
