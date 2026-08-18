interface FileUploadProps { file?: File; onChange(file?: File): void }

export function FileUpload({ file, onChange }: FileUploadProps) {
  return <label>EPUB source<input aria-label="EPUB source" type="file" accept="application/epub+zip,.epub" onChange={(event) => onChange(event.target.files?.[0])} />{file && <span>{file.name}</span>}</label>;
}
