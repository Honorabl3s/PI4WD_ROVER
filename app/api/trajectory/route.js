import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const dataFilePath = path.join(process.cwd(), 'trajectory.json');

export async function GET() {
    try {
        if (!fs.existsSync(dataFilePath)) {
            return NextResponse.json([]);
        }
        const fileData = fs.readFileSync(dataFilePath, 'utf8');
        return NextResponse.json(JSON.parse(fileData));
    } catch (error) {
        return NextResponse.json({ error: 'Gagal membaca data' }, { status: 500 });
    }
}

export async function POST(request) {
    try {
        const data = await request.json();
        fs.writeFileSync(dataFilePath, JSON.stringify(data, null, 2), 'utf8');
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: 'Gagal menyimpan data' }, { status: 500 });
    }
}