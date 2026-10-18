param([Parameter(Mandatory=$true)][string]$FilePath, [string]$ApplicationId)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

[ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IShellItem {
    void BindToHandler(IntPtr context, ref Guid handlerId, ref Guid interfaceId,
        [MarshalAs(UnmanagedType.Interface)] out System.Runtime.InteropServices.ComTypes.IDataObject data);
}

[ComImport, Guid("973810AE-9599-4B88-9E4D-6EE98C9552DA"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IEnumAssocHandlers {
    [PreserveSig] int Next(uint count, out IAssocHandler handler, out uint fetched);
}

[ComImport, Guid("F04061AC-1659-4A3F-A954-775AA57FC083"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAssocHandler {
    void GetName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    void GetUIName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    void GetIconLocation([MarshalAs(UnmanagedType.LPWStr)] out string path, out int index);
    [PreserveSig] int IsRecommended();
    void MakeDefault([MarshalAs(UnmanagedType.LPWStr)] string description);
    void Invoke(System.Runtime.InteropServices.ComTypes.IDataObject data);
}

public class FileApplication {
    public string id;
    public string name;
    public string iconPath;
}

public static class FileApplications {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    static extern void SHAssocEnumHandlers(string extension, uint filter, out IEnumAssocHandlers handlers);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    static extern void SHCreateItemFromParsingName(string path, IntPtr context, ref Guid interfaceId,
        [MarshalAs(UnmanagedType.Interface)] out IShellItem item);

    static System.Runtime.InteropServices.ComTypes.IDataObject CreateDataObject(string filePath) {
        var shellItemId = typeof(IShellItem).GUID;
        IShellItem item;
        SHCreateItemFromParsingName(filePath, IntPtr.Zero, ref shellItemId, out item);
        try {
            var handlerId = new Guid("B8C0BD9F-ED24-455C-83E6-D5390C4FE8C4");
            var dataObjectId = typeof(System.Runtime.InteropServices.ComTypes.IDataObject).GUID;
            System.Runtime.InteropServices.ComTypes.IDataObject data;
            item.BindToHandler(IntPtr.Zero, ref handlerId, ref dataObjectId, out data);
            return data;
        } finally {
            Marshal.ReleaseComObject(item);
        }
    }

    static List<IAssocHandler> Handlers(string filePath) {
        IEnumAssocHandlers enumerator;
        SHAssocEnumHandlers(Path.GetExtension(filePath), 1, out enumerator);
        var handlers = new List<IAssocHandler>();
        try {
            IAssocHandler handler;
            uint fetched;
            while (enumerator.Next(1, out handler, out fetched) == 0 && fetched == 1)
                handlers.Add(handler);
        } finally {
            Marshal.ReleaseComObject(enumerator);
        }
        return handlers;
    }

    public static FileApplication[] List(string filePath) {
        var handlers = Handlers(filePath);
        var applications = new List<FileApplication>();
        try {
            foreach (var handler in handlers) {
                string id, name;
                try {
                    handler.GetName(out id);
                    handler.GetUIName(out name);
                } catch (COMException) {
                    continue;
                }
                applications.Add(new FileApplication { id = id, name = name, iconPath = id });
            }
        } finally {
            foreach (var handler in handlers) Marshal.ReleaseComObject(handler);
        }
        return applications.ToArray();
    }

    public static void Open(string filePath, string applicationId) {
        var handlers = Handlers(filePath);
        try {
            foreach (var handler in handlers) {
                string id;
                try {
                    handler.GetName(out id);
                } catch (COMException) {
                    continue;
                }
                if (id != applicationId) continue;
                var data = CreateDataObject(filePath);
                try {
                    handler.Invoke(data);
                } finally {
                    Marshal.ReleaseComObject(data);
                }
                return;
            }
            throw new InvalidOperationException("The selected application is no longer available.");
        } finally {
            foreach (var handler in handlers) Marshal.ReleaseComObject(handler);
        }
    }
}
'@

if ($ApplicationId) {
    [FileApplications]::Open($FilePath, $ApplicationId)
} else {
    ConvertTo-Json -InputObject @([FileApplications]::List($FilePath)) -Compress
}