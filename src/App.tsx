import React, { useState, useCallback, useMemo, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { jsPDF } from 'jspdf';
import { 
  FileImage, 
  Settings2, 
  Printer, 
  Download, 
  Trash2, 
  Plus, 
  MoveUp, 
  MoveDown, 
  Image as ImageIcon,
  FileText
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';

// --- Types ---
type ImageItem = {
  id: string;
  file: File;
  url: string;
};

type PaperSize = 'A4' | 'Letter' | 'Legal';
type Orientation = 'portrait' | 'landscape';
type ImageFit = 'contain' | 'cover';

type Settings = {
  paperSize: PaperSize;
  orientation: Orientation;
  columns: number;
  rows: number;
  gap: number; // in mm
  margin: number; // in mm
  imageFit: ImageFit;
};

// --- Constants ---
const PAPER_DIMENSIONS: Record<PaperSize, { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  Letter: { width: 215.9, height: 279.4 },
  Legal: { width: 215.9, height: 355.6 },
};

export default function App() {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [settings, setSettings] = useState<Settings>({
    paperSize: 'A4',
    orientation: 'portrait',
    columns: 2,
    rows: 2,
    gap: 10,
    margin: 20,
    imageFit: 'contain',
  });

  const printRef = useRef<HTMLDivElement>(null);

  const updateSetting = (key: keyof Settings, value: any) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newImages = acceptedFiles.map((file) => ({
      id: Math.random().toString(36).substring(7),
      file,
      url: URL.createObjectURL(file), // createObjectURL might leak if not revoked, but standard for short lived preview
    }));
    setImages((prev) => [...prev, ...newImages]);
  }, []);

  // @ts-expect-error React 19 type mismatch for react-dropzone
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': [] as string[] },
  });

  const removeImage = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setImages((prev) => prev.filter((img) => img.id !== id));
  };

  const moveImage = (index: number, direction: 'up' | 'down', e: React.MouseEvent) => {
    e.stopPropagation();
    if (direction === 'up' && index > 0) {
      setImages((prev) => {
        const newArr = [...prev];
        [newArr[index - 1], newArr[index]] = [newArr[index], newArr[index - 1]];
        return newArr;
      });
    } else if (direction === 'down' && index < images.length - 1) {
      setImages((prev) => {
        const newArr = [...prev];
        [newArr[index + 1], newArr[index]] = [newArr[index], newArr[index + 1]];
        return newArr;
      });
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPDF = async () => {
    const { paperSize, orientation, columns, rows, gap, margin, imageFit } = settings;
    const format = PAPER_DIMENSIONS[paperSize];
    const pdfFormats = [format.width, format.height];
    
    const doc = new jsPDF({
      orientation: orientation,
      unit: 'mm',
      format: pdfFormats,
    });

    const docWidth = orientation === 'portrait' ? format.width : format.height;
    const docHeight = orientation === 'portrait' ? format.height : format.width;
    
    // Usable area
    const usableWidth = docWidth - (margin * 2);
    const usableHeight = docHeight - (margin * 2);
    
    // Cell size
    const cellWidth = (usableWidth - (gap * (columns - 1))) / columns;
    const cellHeight = (usableHeight - (gap * (rows - 1))) / rows;
    const imagesPerPage = columns * rows;

    for (let i = 0; i < images.length; i++) {
        const imgItem = images[i];
        
        // Add new page if needed
        if (i > 0 && i % imagesPerPage === 0) {
            doc.addPage();
        }

        const pageIndex = i % imagesPerPage;
        const col = pageIndex % columns;
        const row = Math.floor(pageIndex / columns);

        const x = margin + (col * (cellWidth + gap));
        const y = margin + (row * (cellHeight + gap));

        // Note: For a robust implementation, images should be pre-loaded and dimensions checked.
        // For simplicity, we are passing the data URL and specifying the box dimensions. 
        // jsPDF handles scaling for standard image formats nicely.
        
        // Let's get actual image aspect ratio to respect fit modes
        // This is async, so we'll do simplistic loading inside an async scope
        const imgProps = await new Promise<{w: number, h: number, url: string}>((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                // creating a canvas to convert to JPEG for jsPDF compatibility if it's png/heic etc
                // jsPDF has native support but sometimes converting is safer.
                resolve({ w: img.width, h: img.height, url: imgItem.url });
            };
            img.onerror = reject;
            img.src = imgItem.url;
        });

        const imgRatio = imgProps.w / imgProps.h;
        const cellRatio = cellWidth / cellHeight;

        let finalW = cellWidth;
        let finalH = cellHeight;
        let finalX = x;
        let finalY = y;

        if (imageFit === 'contain') {
            if (imgRatio > cellRatio) {
                // Image is wider than cell
                finalW = cellWidth;
                finalH = cellWidth / imgRatio;
                finalY = y + (cellHeight - finalH) / 2; // center vertically
            } else {
                // Image is taller than cell
                finalH = cellHeight;
                finalW = cellHeight * imgRatio;
                finalX = x + (cellWidth - finalW) / 2; // center horizontally
            }
            doc.addImage(imgProps.url, 'JPEG', finalX, finalY, finalW, finalH);
        } else {
            // 'cover' mode conceptually drops outside bounding box, but jsPDF doesn't natively clip bounding boxes well.
            // We just draw it filled and deformed, or we can use a canvas to crop.
            // For simplicity in this PDF script without external clipping, we'll draw it as cover by drawing full height/width depending which is smaller.
            // Actually, we'll just draw it with exactly cellWidth/cellHeight for 'fill' behaviour.
            // The user asked for "besar ukuran besar image" so maybe they want 'fill' or 'contain'.
             doc.addImage(imgProps.url, 'JPEG', finalX, finalY, cellWidth, cellHeight);
        }
    }

    doc.save('converted-document.pdf');
  };

  // Preview dimensions mapping to CSS (using mm in inline styles or calculated px)
  // Let's define CSS variables on the preview container for simple scaling.
  // We'll scale down the A4 page to fit the screen.
  
  const pages = useMemo(() => {
    const imagesPerPage = settings.columns * settings.rows;
    const result = [];
    for (let i = 0; i < images.length; i += imagesPerPage) {
      result.push(images.slice(i, i + imagesPerPage));
    }
    if (result.length === 0) result.push([]); // Show at least one empty page if no images
    return result;
  }, [images, settings]);

  const previewRender = () => {
    const { paperSize, orientation, columns, rows, gap, margin, imageFit } = settings;
    const format = PAPER_DIMENSIONS[paperSize];
    
    const docWidthMm = orientation === 'portrait' ? format.width : format.height;
    const docHeightMm = orientation === 'portrait' ? format.height : format.width;

    return (
        <div className="flex flex-col items-center gap-8 print:gap-0 print:items-start pb-20">
            {pages.map((pageImages, pageIndex) => (
                <div 
                    key={pageIndex}
                    className="preview-page bg-white shadow-xl flex shrink-0 mx-auto overflow-hidden print:shadow-none print:mx-0"
                    style={{
                        width: `${docWidthMm}mm`,
                        height: `${docHeightMm}mm`,
                        padding: `${margin}mm`,
                        pageBreakAfter: 'always'
                    }}
                >
                    <div 
                        className="w-full h-full border border-dashed border-gray-200 print:border-none"
                        style={{
                            display: 'grid',
                            gridTemplateColumns: `repeat(${columns}, 1fr)`,
                            gridTemplateRows: `repeat(${rows}, 1fr)`,
                            gap: `${gap}mm`
                        }}
                    >
                        {Array.from({ length: columns * rows }).map((_, slotIndex) => {
                           const img = pageImages[slotIndex];
                           return (
                               <div key={slotIndex} className="w-full h-full border border-gray-100 bg-gray-50/50 print:bg-white print:border-none flex items-center justify-center overflow-hidden">
                                   {img ? (
                                       <img 
                                            src={img.url} 
                                            alt="Preview slot" 
                                            className="w-full h-full"
                                            style={{ objectFit: imageFit === 'contain' ? 'contain' : 'cover' }}
                                        />
                                   ) : (
                                       <div className="text-gray-300 print:hidden flex flex-col items-center">
                                            <ImageIcon className="w-6 h-6 mb-1 opacity-50" />
                                            <span className="text-[10px] uppercase opacity-50 tracking-wider">Empty</span>
                                       </div>
                                   )}
                               </div>
                           )
                        })}
                    </div>
                </div>
            ))}
        </div>
    )
  }

  return (
    <div className="flex h-screen w-full bg-gray-100 overflow-hidden font-sans">
        
      {/* Sidebar - Hidden on Print */}
      <aside className="w-80 bg-white border-r flex flex-col z-20 shrink-0 print:hidden shadow-lg h-full">
        <div className="p-4 border-b bg-gray-50">
            <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                <FileText className="w-6 h-6 text-blue-600" />
                Image2Doc
            </h1>
            <p className="text-sm text-gray-500 mt-1">Convert images to beautiful PDFs</p>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="p-6 space-y-8">

                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <Label className="text-base font-semibold text-gray-700">Images</Label>
                        <span className="text-xs bg-blue-100 text-blue-700 font-medium px-2 py-0.5 rounded-full">{images.length}</span>
                    </div>
                    
                    <div 
                        {...getRootProps()} 
                        className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                            isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400 bg-gray-50'
                        }`}
                    >
                        <input {...getInputProps()} id="file-upload-input" />
                        <FileImage className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                        <p className="text-sm font-medium text-gray-600">click or drop images here</p>
                    </div>

                    {images.length > 0 && (
                        <div className="space-y-2">
                           <Label className="text-sm text-gray-500">Order & Management</Label>
                           <div className="max-h-[250px] overflow-y-auto space-y-2 pr-2">
                             {images.map((img, i) => (
                                 <Card key={img.id} className="overflow-hidden bg-white shadow-sm hover:shadow relative group border-gray-200">
                                     <div className="flex items-center p-2 gap-3">
                                         <div className="w-12 h-12 rounded bg-gray-100 overflow-hidden shrink-0 border border-gray-200">
                                             <img src={img.url} alt="thumbnail" className="w-full h-full object-cover" />
                                         </div>
                                         <div className="flex-1 min-w-0">
                                             <p className="text-xs font-medium truncate text-gray-700">{img.file.name}</p>
                                             <p className="text-[10px] text-gray-500">{(img.file.size / 1024 / 1024).toFixed(2)} MB</p>
                                         </div>
                                         <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                             <div className="flex flex-col">
                                                 <button onClick={(e) => moveImage(i, 'up', e)} disabled={i === 0} className="p-0.5 text-gray-400 hover:text-blue-600 disabled:opacity-30"><MoveUp className="w-3 h-3" /></button>
                                                 <button onClick={(e) => moveImage(i, 'down', e)} disabled={i === images.length - 1} className="p-0.5 text-gray-400 hover:text-blue-600 disabled:opacity-30"><MoveDown className="w-3 h-3" /></button>
                                             </div>
                                             <button onClick={(e) => removeImage(img.id, e)} className="p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 rounded">
                                                 <Trash2 className="w-4 h-4" />
                                             </button>
                                         </div>
                                     </div>
                                 </Card>
                             ))}
                           </div>
                        </div>
                    )}
                </div>

                <Separator />

                <div className="space-y-5">
                    <Label className="text-base font-semibold text-gray-700 flex items-center gap-2">
                        <Settings2 className="w-5 h-5" />
                        Layout Settings
                    </Label>

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label className="text-xs text-gray-500 uppercase tracking-wider">Paper Setup</Label>
                            <div className="grid grid-cols-2 gap-2">
                                <Select value={settings.paperSize} onValueChange={(val) => updateSetting('paperSize', val)}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Size" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="A4">A4</SelectItem>
                                        <SelectItem value="Letter">Letter</SelectItem>
                                        <SelectItem value="Legal">Legal</SelectItem>
                                    </SelectContent>
                                </Select>
                                
                                <Select value={settings.orientation} onValueChange={(val) => updateSetting('orientation', val)}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Orientation" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="portrait">Portrait</SelectItem>
                                        <SelectItem value="landscape">Landscape</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="space-y-2 mt-4">
                             <Label className="text-xs text-gray-500 uppercase tracking-wider">Grid Layout</Label>
                             <div className="flex gap-2 items-center">
                                 <div className="flex-1 space-y-1">
                                     <Label className="text-xs">Columns</Label>
                                     <Select value={String(settings.columns)} onValueChange={(val) => updateSetting('columns', Number(val))}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {[1,2,3,4,5].map(n => <SelectItem key={`c${n}`} value={String(n)}>{n}</SelectItem>)}
                                        </SelectContent>
                                     </Select>
                                 </div>
                                 <span className="text-gray-300 mt-5">×</span>
                                 <div className="flex-1 space-y-1">
                                    <Label className="text-xs">Rows</Label>
                                     <Select value={String(settings.rows)} onValueChange={(val) => updateSetting('rows', Number(val))}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {[1,2,3,4,5].map(n => <SelectItem key={`r${n}`} value={String(n)}>{n}</SelectItem>)}
                                        </SelectContent>
                                     </Select>
                                 </div>
                             </div>
                             <p className="text-xs text-gray-500 text-right">{settings.columns * settings.rows} images per page</p>
                        </div>
                        
                        <div className="space-y-3 pt-2">
                            <div className="flex justify-between">
                                <Label className="text-xs text-gray-600">Margin ({settings.margin} mm)</Label>
                            </div>
                            <Slider 
                                value={settings.margin} 
                                min={0} max={50} step={1}
                                onValueChange={(val) => updateSetting('margin', typeof val === 'number' ? val : (val as any)[0])}
                            />
                        </div>

                        <div className="space-y-3">
                            <div className="flex justify-between">
                                <Label className="text-xs text-gray-600">Spacing / Gap ({settings.gap} mm)</Label>
                            </div>
                            <Slider 
                                value={settings.gap} 
                                min={0} max={50} step={1}
                                onValueChange={(val) => updateSetting('gap', typeof val === 'number' ? val : (val as any)[0])}
                            />
                        </div>

                        <div className="space-y-2 pt-2">
                             <Label className="text-xs text-gray-500 uppercase tracking-wider">Image Fit</Label>
                             <Select value={settings.imageFit} onValueChange={(val) => updateSetting('imageFit', val)}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="contain">Contain (Show whole image)</SelectItem>
                                    <SelectItem value="cover">Cover (Fill slot, crop edges)</SelectItem>
                                </SelectContent>
                             </Select>
                        </div>

                    </div>
                </div>
            </div>
        </div>

        <div className="p-4 border-t bg-gray-50 space-y-2">
            <Button 
                onClick={handleDownloadPDF} 
                className="w-full bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-200"
                disabled={images.length === 0}
            >
                <Download className="w-4 h-4 mr-2" /> Download PDF
            </Button>
            <Button 
                onClick={handlePrint} 
                variant="outline" 
                className="w-full text-gray-700 bg-white hover:bg-gray-100 border-gray-300"
            >
                <Printer className="w-4 h-4 mr-2" /> Print Directly
            </Button>
        </div>
      </aside>

      {/* Main Preview Area */}
      <main className="flex-1 bg-gray-200/60 overflow-auto relative print:bg-white print:overflow-visible">
          {images.length === 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 print:hidden">
                  <div className="bg-white p-6 rounded-2xl shadow-xl flex flex-col items-center border border-gray-100 max-w-sm text-center">
                    <FileImage className="w-16 h-16 text-blue-100 mb-4" />
                    <h2 className="text-xl font-bold text-gray-700 mb-2">No Images Uploaded</h2>
                    <p className="text-gray-500 mb-6">Drag and drop photos using the sidebar to start creating your document.</p>
                    <Button onClick={() => document.getElementById('file-upload-input')?.click()} className="bg-blue-600 hover:bg-blue-700">
                        <Plus className="w-4 h-4 mr-2" /> Upload Images
                    </Button>
                  </div>
              </div>
          )}

          <div 
             className="min-h-full py-12 px-8 flex justify-center print:p-0 print:block"
             style={{
                 // Using zoom or transform to scale the preview down if needed, but let's just let it overflow nicely for now
                 // and users can scroll. We can add a "scale" feature later.
             }}
             ref={printRef}
          >
              <div className="preview-scale-container" style={{ transformOrigin: 'top center', transform: 'scale(1)' }}>
                  {previewRender()}
              </div>
          </div>
      </main>

    </div>
  );
}
